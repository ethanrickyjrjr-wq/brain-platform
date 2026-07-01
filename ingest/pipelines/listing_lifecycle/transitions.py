"""Pure lifecycle diff engine — no DB, no I/O.

Compare today's scan to the stored state per (address_key, sale_or_rent); return MERGE upserts
(never delete) + the durable transition history. The transition IS the signal: a new listing
appears (from_state None), a price moves within active (cut/raise), a listing leaves the active
market → HOLDING (reason TBD), and a holding listing reappears → back on market (relist).

Two gates the operator + advisor review made load-bearing:
- `scan_complete` (from coverage_guard): a prior-live listing absent from an INCOMPLETE pull is a
  scrape gap, NOT a withdrawal — only a complete pull licenses pulled-by-elimination.
- `is_seed` (prior empty for the scope = first-ever run): stamps every emitted transition seed=True
  so the brain's flow metrics exclude the day-1 baseline (else the whole inventory reads as "new")."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

# "Live, for sale, should reappear in a complete pull." Absence from a COMPLETE pull => the listing
# left the active market — we move it to HOLDING (reason unknown: sold / pending / withdrawn — the
# source doesn't say, so we don't claim). A records lane resolves holding later; if it reappears in a
# scan, it transitions back out of holding (a relist / back-on-market).
_LIVE_STATES = frozenset({"active", "new", "coming_soon", "back_on_market"})

Key = tuple[str, str]  # (address_key, sale_or_rent)


def _to_int(v: Any) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def diff_states(
    prior: dict[Key, dict[str, Any]],
    scanned: dict[Key, dict[str, Any]],
    today: str,
    scan_complete: bool,
    is_seed: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    upserts: list[dict[str, Any]] = []
    transitions: list[dict[str, Any]] = []

    for key in set(prior) | set(scanned):
        addr, sor = key
        prev = prior.get(key)
        cur = scanned.get(key)

        if cur is not None:
            state = cur.get("state")
            price = _to_int(cur.get("list_price"))

            if prev is None:
                # APPEARED — first time we've seen this property (this sale/rent side). The new-listing
                # signal is from_state IS NULL, regardless of whether the source labels it new/active.
                upserts.append(_upsert(addr, sor, cur, state, days_in_state=0))
                transitions.append(_transition(addr, sor, None, state, today, cur, price, None, None, is_seed))
                continue

            prev_state = prev.get("state")
            prev_price = _to_int(prev.get("list_price"))

            if state == prev_state:
                # SAME state — merge the row (touch last_seen, age days_in_state); a price move
                # within the state is a cut/raise (needs only presence-in-both, not full completeness).
                days = (_to_int(prev.get("days_in_state")) or 0) + 1
                upserts.append(_upsert(addr, sor, cur, state, days_in_state=days))
                if price is not None and prev_price is not None and price != prev_price:
                    transitions.append(
                        _transition(addr, sor, prev_state, state, today, cur,
                                    price, price - prev_price, _to_int(prev.get("days_in_state")), is_seed)
                    )
            else:
                # STATE CHANGE — the headline signal.
                delta = price - prev_price if (price is not None and prev_price is not None) else None
                upserts.append(_upsert(addr, sor, cur, state, days_in_state=0))
                transitions.append(
                    _transition(addr, sor, prev_state, state, today, cur,
                                price, delta, _to_int(prev.get("days_in_state")), is_seed)
                )
        else:
            # ABSENT today. Move to HOLDING ONLY on a complete pull AND only from a live for-sale
            # state (we don't assert WHY it left — sold/pending/withdrawn is unknown). On an
            # incomplete pull, absence is a scrape gap — leave the row untouched.
            if scan_complete and prev.get("state") in _LIVE_STATES:
                upserts.append(_upsert(addr, sor, prev, "holding", days_in_state=0))
                transitions.append(
                    _transition(addr, sor, prev.get("state"), "holding", today, prev,
                                _to_int(prev.get("list_price")), None, _to_int(prev.get("days_in_state")), is_seed)
                )

    return upserts, transitions


def _upsert(addr: str, sor: str, row: dict[str, Any], state: str, *, days_in_state: int) -> dict[str, Any]:
    """The wide row to MERGE into listing_state. Carries every captured field; first_seen/scraped_at
    are stamped by the pipeline's SQL (first_seen via DEFAULT-on-insert only)."""
    out = {k: v for k, v in row.items() if k not in ("state", "days_in_state")}
    out["address_key"] = addr
    out["sale_or_rent"] = sor
    out["state"] = state
    out["days_in_state"] = days_in_state
    return out


def _transition(addr, sor, from_state, to_state, at, row, price, price_delta, days_in_prev_state, seed):
    return {
        "address_key": addr,
        "sale_or_rent": sor,
        "from_state": from_state,
        "to_state": to_state,
        "at": at,
        "listing_id": row.get("listing_id"),
        "price": price,
        "price_delta": price_delta,
        "days_in_prev_state": days_in_prev_state,
        "seed": seed,
    }


# ---------------------------------------------------------------- off-market hook (Phase-2 Part A)
# The diff engine above leaves every departure as ambiguous `holding` (it never claims WHY a listing
# left). The off-market hook resolves a *budget-sampled* subset of those into `sold` (with price+date)
# or `withdrawn`, using a live /property-tax-history probe (extract_api.fetch_sold_event). This module
# stays pure: it only PLANS which listings to probe and APPLIES the results back into the (upserts,
# transitions) the pipeline writes — the network call itself lives in pipeline.py.

SOLD = "sold"
WITHDRAWN = "withdrawn"
HOLDING = "holding"


def _as_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        try:
            return date.fromisoformat(v[:10])
        except ValueError:
            return None
    return None


def plan_off_market_checks(
    upserts: list[dict[str, Any]],
    transitions: list[dict[str, Any]],
    prior: dict[Key, dict[str, Any]],
    today: str,
    *,
    cap: int,
    departure_fraction: float = 0.6,
    recheck_min_days: int = 21,
    recheck_max_days: int = 180,
    recheck_interval_days: int = 30,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Pure: choose which off-market listings to spend a paid probe on this run, within `cap` calls.

    Two populations share the budget:
      • DEPARTURES — listings that flipped to `holding` THIS run (a to_state='holding' transition). The
        freshest sold-capture shot; `since` = today.
      • RECHECKS — listings already in `holding` from a PRIOR run, aged into [min,max] days and not
        probed within `recheck_interval_days` (tracked by state.sold_check_at). Catches the
        pending-then-closed sales the departure probe was too early to see; `since` = the day it left
        active (today - days_in_holding).

    Priority = list_price desc (the operator's explicit 'higher-value' instruction — so the resulting
    sold set skews expensive; the caller logs that bias), tie-broken by days desc (longest first).
    Departures get first claim but reserve a slice (`1 - departure_fraction`) for rechecks when both
    populations exist. Candidates without a `property_id` can't be probed and are skipped.

    Returns (checks, stats). Each check = {kind, key, property_id, since, list_price, days}."""
    empty_stats = {"cap": cap, "departures_available": 0, "rechecks_available": 0,
                   "departures_checked": 0, "rechecks_checked": 0, "dropped": 0}
    if cap <= 0:
        return [], empty_stats
    today_d = _as_date(today)

    departures: list[dict[str, Any]] = []
    for t in transitions:
        if t.get("to_state") != HOLDING:
            continue
        key = (t.get("address_key"), t.get("sale_or_rent"))
        pid = (prior.get(key) or {}).get("property_id")
        if not pid:
            continue
        departures.append({
            "kind": "departure", "key": key, "property_id": str(pid), "since": today,
            "list_price": _to_int(t.get("price")) or 0, "days": _to_int(t.get("days_in_prev_state")) or 0,
        })

    rechecks: list[dict[str, Any]] = []
    for key, prow in prior.items():
        if prow.get("state") != HOLDING:
            continue
        pid = prow.get("property_id")
        # HOLDING AGE comes from last_seen (stamped once at holding entry, then frozen — diff never
        # re-upserts a still-absent holding), NOT days_in_state (which freezes at 0 and never ages).
        entered = _as_date(prow.get("last_seen"))
        if not pid or entered is None or today_d is None:
            continue
        holding_age = (today_d - entered).days
        if not (recheck_min_days <= holding_age <= recheck_max_days):
            continue
        probed = _as_date(prow.get("sold_check_at"))
        if probed is not None and (today_d - probed).days < recheck_interval_days:
            continue
        rechecks.append({
            "kind": "recheck", "key": key, "property_id": str(pid),
            "since": entered.isoformat(),         # the day it left active ≈ the day it entered holding
            "list_price": _to_int(prow.get("list_price")) or 0, "days": holding_age,
        })

    _pri = lambda c: (c["list_price"], c["days"])
    departures.sort(key=_pri, reverse=True)
    rechecks.sort(key=_pri, reverse=True)

    # Departures may claim the whole budget only when there is nothing to re-check; otherwise reserve.
    dep_cap = cap if not rechecks else max(1, round(cap * departure_fraction))
    dep_take = min(len(departures), dep_cap)
    rc_take = min(len(rechecks), cap - dep_take)
    # Don't strand budget: hand any unused slots (e.g. fewer rechecks than reserved) back to departures.
    leftover = cap - dep_take - rc_take
    if leftover > 0:
        dep_take += min(len(departures) - dep_take, leftover)

    checks = departures[:dep_take] + rechecks[:rc_take]
    stats = {
        "cap": cap,
        "departures_available": len(departures),
        "rechecks_available": len(rechecks),
        "departures_checked": dep_take,
        "rechecks_checked": rc_take,
        "dropped": (len(departures) - dep_take) + (len(rechecks) - rc_take),
    }
    return checks, stats


def _terminal_transition(key: Key, prow: dict[str, Any], to_state: str, at: str, *,
                         sold_price: int | None, sold_date: str | None) -> dict[str, Any]:
    addr, sor = key
    return {
        "address_key": addr, "sale_or_rent": sor,
        "from_state": HOLDING, "to_state": to_state, "at": at,
        "listing_id": prow.get("listing_id"),
        "price": _to_int(prow.get("list_price")),
        "price_delta": None,
        "days_in_prev_state": _to_int(prow.get("days_in_state")),
        "seed": False,
        "sold_price": sold_price, "sold_date": sold_date,
    }


def _terminal_upsert(key: Key, prow: dict[str, Any], state: str, *, days_in_state: int) -> dict[str, Any]:
    addr, sor = key
    row = dict(prow)
    row["address_key"] = addr
    row["sale_or_rent"] = sor
    row["state"] = state
    row["days_in_state"] = days_in_state
    return row


def apply_off_market_resolutions(
    upserts: list[dict[str, Any]],
    transitions: list[dict[str, Any]],
    checks: list[dict[str, Any]],
    resolutions: list[dict[str, Any]],
    prior: dict[Key, dict[str, Any]],
    today: str,
) -> dict[str, Any]:
    """Pure: fold the probe results back into the (upserts, transitions) lists the pipeline writes.
    `resolutions[i]` corresponds to `checks[i]`.

      • DEPARTURE + sold/withdrawn -> mutate the existing to_state='holding' transition in place (one
        transition per listing per day) to the terminal state, attach sold_price/sold_date, flip the
        matching upsert's state. A real `holding` outcome (e.g. pending) leaves it holding.
      • RECHECK + sold/withdrawn -> the listing was already holding (the diff emitted nothing this run),
        so APPEND a fresh holding->terminal transition + a terminal state upsert. A real `holding`
        outcome touches neither list (nothing new asserted). A `gap` does nothing.

    The `sold_check_at` stamp is NOT applied here — every non-`gap` key is returned in `checked_keys`
    so the pipeline can stamp them via a targeted UPDATE that preserves last_seen (the holding-age
    anchor). A `gap` (transient API failure) is left unstamped so it retries next run.

    Returns {'sold', 'withdrawn', 'holding_unresolved', 'checked_keys'}."""
    ups_by_key = {(u.get("address_key"), u.get("sale_or_rent")): u for u in upserts}
    hold_trans_by_key = {
        (t.get("address_key"), t.get("sale_or_rent")): t
        for t in transitions if t.get("to_state") == HOLDING and t.get("at") == today
    }
    stats: dict[str, Any] = {"sold": 0, "withdrawn": 0, "holding_unresolved": 0, "checked_keys": []}

    for chk, res in zip(checks, resolutions):
        key = chk["key"]
        outcome = (res or {}).get("outcome", "gap")
        if outcome == "gap":
            stats["holding_unresolved"] += 1
            continue  # transient failure — not stamped, retry next run.
        stats["checked_keys"].append(key)  # got a real answer -> the pipeline stamps sold_check_at.

        terminal = SOLD if outcome == "sold" else WITHDRAWN if outcome == "withdrawn" else None
        sold_price = _to_int(res.get("sold_price")) if outcome == "sold" else None
        sold_date = res.get("sold_date") if outcome == "sold" else None

        if chk["kind"] == "departure":
            t = hold_trans_by_key.get(key)
            u = ups_by_key.get(key)
            if terminal is not None and t is not None:
                t["to_state"] = terminal
                t["sold_price"] = sold_price
                t["sold_date"] = sold_date
                if u is not None:
                    u["state"] = terminal
                stats[terminal] += 1
            else:
                stats["holding_unresolved"] += 1  # real 'holding' (pending): stays holding, stamped.
        else:  # recheck — no diff output exists for this key.
            prow = prior.get(key) or {}
            if terminal is not None:
                transitions.append(_terminal_transition(key, prow, terminal, today,
                                                         sold_price=sold_price, sold_date=sold_date))
                upserts.append(_terminal_upsert(key, prow, terminal, days_in_state=0))
                stats[terminal] += 1
            else:
                stats["holding_unresolved"] += 1  # stays holding — stamped only (no ups/trans row).
    return stats
