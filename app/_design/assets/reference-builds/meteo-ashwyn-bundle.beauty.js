! function() {
    const t = document.createElement("link").relList;
    if (!(t && t.supports && t.supports("modulepreload"))) {
        for (const t of document.querySelectorAll('link[rel="modulepreload"]')) e(t);
        new MutationObserver(t => {
            for (const n of t)
                if ("childList" === n.type)
                    for (const t of n.addedNodes) "LINK" === t.tagName && "modulepreload" === t.rel && e(t)
        }).observe(document, {
            childList: !0,
            subtree: !0
        })
    }

    function e(t) {
        if (t.ep) return;
        t.ep = !0;
        const e = function(t) {
            const e = {};
            return t.integrity && (e.integrity = t.integrity), t.referrerPolicy && (e.referrerPolicy = t.referrerPolicy), "use-credentials" === t.crossOrigin ? e.credentials = "include" : "anonymous" === t.crossOrigin ? e.credentials = "omit" : e.credentials = "same-origin", e
        }(t);
        fetch(t.href, e)
    }
}();
var t = class {
        static async getSuggestions(t) {
            if (!t || t.trim().length < 2) return [];
            const e = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(t)}&format=json&limit=50&accept-language=en`;
            try {
                const t = await fetch(e, {
                    headers: {
                        "User-Agent": "ashMeteo/1.0 (historical-weather-viz)"
                    }
                });
                if (!t.ok) return [];
                const n = await t.json(),
                    i = new Set,
                    a = [];
                for (const e of n) i.has(e.display_name) || (i.add(e.display_name), a.push({
                    name: e.display_name.split(",")[0],
                    fullAddress: e.display_name,
                    lat: parseFloat(e.lat),
                    lon: parseFloat(e.lon)
                }));
                return a
            } catch {
                return []
            }
        }
        static async getReverseLookup(t, e) {
            const n = `https://nominatim.openstreetmap.org/reverse?lat=${t}&lon=${e}&format=json&accept-language=en`;
            try {
                const i = await fetch(n, {
                    headers: {
                        "User-Agent": "ashMeteo/1.0 (historical-weather-viz)"
                    }
                });
                if (!i.ok) throw new Error("Failed to perform reverse lookup");
                const a = await i.json();
                return a && a.display_name ? {
                    name: a.display_name.split(",")[0],
                    fullAddress: a.display_name
                } : {
                    name: `${t}, ${e}`,
                    fullAddress: `${t}, ${e}`
                }
            } catch (i) {
                return {
                    name: `${t}, ${e}`,
                    fullAddress: `${t}, ${e}`
                }
            }
        }
        static async getCoordinates(t) {
            if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(t)) {
                const [e, n] = t.split(",").map(t => parseFloat(t.trim()));
                return {
                    lat: e,
                    lon: n,
                    name: t
                }
            }
            const e = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(t)}&format=json&limit=1&accept-language=en`;
            try {
                const t = await fetch(e, {
                    headers: {
                        "User-Agent": "ashMeteo/1.0 (historical-weather-viz)"
                    }
                });
                if (!t.ok) throw new Error("Failed to fetch location data");
                const n = await t.json();
                if (0 === n.length) throw new Error("Location not found");
                return {
                    lat: parseFloat(n[0].lat),
                    lon: parseFloat(n[0].lon),
                    name: n[0].display_name.split(",")[0],
                    fullAddress: n[0].display_name
                }
            } catch (n) {
                throw n
            }
        }
        static async getHistoricalData(t, e, n = null) {
            const i = (new Date).getFullYear() - 1,
                a = i - 29,
                r = [{
                    start: a,
                    end: a + 9
                }, {
                    start: a + 10,
                    end: a + 19
                }, {
                    start: a + 20,
                    end: i
                }],
                s = {};
            let o = 0;
            const l = r.map(async ({
                start: i,
                end: a
            }) => {
                const s = `https://archive-api.open-meteo.com/v1/archive?latitude=${t}&longitude=${e}&start_date=${i}-01-01&end_date=${a}-12-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
                try {
                    const t = await fetch(s);
                    if (429 === t.status) throw new Error("Rate limit exceeded for weather data. Please try again later.");
                    if (!t.ok) throw new Error("Failed to fetch weather data");
                    const e = await t.json();
                    if (!e.daily) throw new Error("Invalid data format received");
                    const l = this.aggregateMonthlyData(e.daily, i, a),
                        c = ++o;
                    return n && n(Math.round(c / r.length * 100)), l
                } catch (l) {
                    throw l
                }
            });
            return (await Promise.all(l)).forEach(t => {
                Object.assign(s, t)
            }), s
        }
        static aggregateMonthlyData(t, e, n) {
            const {
                time: i,
                temperature_2m_max: a,
                temperature_2m_min: r,
                precipitation_sum: s
            } = t, o = {};
            for (let l = e; l <= n; l++) o[l] = Array(12).fill(null).map((t, e) => ({
                month: e,
                minSum: 0,
                maxSum: 0,
                count: 0,
                precip: 0,
                absMax: -1 / 0,
                absMin: 1 / 0
            }));
            for (let l = 0; l < i.length; l++) {
                const t = i[l],
                    c = parseInt(t.substring(0, 4), 10),
                    h = parseInt(t.substring(5, 7), 10) - 1;
                if (c < e || c > n) continue;
                const u = a[l],
                    d = r[l],
                    p = s[l] || 0,
                    m = o[c][h];
                null !== u && null !== d && (m.maxSum += u, m.minSum += d, m.count++, u > m.absMax && (m.absMax = u), d < m.absMin && (m.absMin = d)), m.precip += p
            }
            for (let l = e; l <= n; l++)
                for (let t = 0; t < 12; t++) {
                    const e = o[l][t];
                    0 === e.count ? (e.max = 0, e.min = 0, e.absMax = 0, e.absMin = 0) : (e.max = e.maxSum / e.count, e.min = e.minSum / e.count)
                }
            return o
        }
    },
    e = 0,
    n = 1,
    i = 2,
    a = 0,
    r = 1,
    s = 2,
    o = 3,
    l = 1e3,
    c = 1001,
    h = 1002,
    u = 1003,
    d = 1004,
    p = 1005,
    m = 1006,
    f = 1007,
    g = 1008,
    _ = 1009,
    v = 1012,
    x = 1014,
    M = 1015,
    b = 1016,
    y = 1017,
    S = 1018,
    E = 1023,
    T = 1026,
    w = 1030,
    A = 2300,
    R = 2301,
    C = 2302,
    P = "srgb",
    D = "srgb-linear",
    L = "linear",
    I = "srgb",
    U = 7680,
    N = 2e3;

function O(t) {
    return document.createElementNS("http://www.w3.org/1999/xhtml", t)
}

function F() {
    const t = O("canvas");
    return t.style.display = "block", t
}
var B = {};

function z(...t) {
    t.shift()
}

function V(t) {
    const e = t[0];
    if ("string" == typeof e && e.startsWith("TSL:")) {
        const e = t[1];
        e && e.isStackTrace ? t[0] += " " + e.getLocation() : t[1] = 'Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'
    }
    return t
}

function k(...t) {
    (t = V(t)).shift();
    {
        const e = t[0];
        e && e.isStackTrace
    }
}

function H(...t) {
    (t = V(t)).shift();
    {
        const e = t[0];
        e && e.isStackTrace
    }
}

function G(...t) {
    const e = t.join(" ");
    e in B || (B[e] = !0, k(...t))
}
var W = {
        0: 1,
        2: 6,
        4: 7,
        3: 5,
        1: 0,
        6: 2,
        7: 4,
        5: 3
    },
    X = class {
        addEventListener(t, e) {
            void 0 === this._listeners && (this._listeners = {});
            const n = this._listeners;
            void 0 === n[t] && (n[t] = []), -1 === n[t].indexOf(e) && n[t].push(e)
        }
        hasEventListener(t, e) {
            const n = this._listeners;
            return void 0 !== n && (void 0 !== n[t] && -1 !== n[t].indexOf(e))
        }
        removeEventListener(t, e) {
            const n = this._listeners;
            if (void 0 === n) return;
            const i = n[t];
            if (void 0 !== i) {
                const t = i.indexOf(e); - 1 !== t && i.splice(t, 1)
            }
        }
        dispatchEvent(t) {
            const e = this._listeners;
            if (void 0 === e) return;
            const n = e[t.type];
            if (void 0 !== n) {
                t.target = this;
                const e = n.slice(0);
                for (let n = 0, i = e.length; n < i; n++) e[n].call(this, t);
                t.target = null
            }
        }
    },
    Y = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "0a", "0b", "0c", "0d", "0e", "0f", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "1a", "1b", "1c", "1d", "1e", "1f", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "2a", "2b", "2c", "2d", "2e", "2f", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39", "3a", "3b", "3c", "3d", "3e", "3f", "40", "41", "42", "43", "44", "45", "46", "47", "48", "49", "4a", "4b", "4c", "4d", "4e", "4f", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "5a", "5b", "5c", "5d", "5e", "5f", "60", "61", "62", "63", "64", "65", "66", "67", "68", "69", "6a", "6b", "6c", "6d", "6e", "6f", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79", "7a", "7b", "7c", "7d", "7e", "7f", "80", "81", "82", "83", "84", "85", "86", "87", "88", "89", "8a", "8b", "8c", "8d", "8e", "8f", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99", "9a", "9b", "9c", "9d", "9e", "9f", "a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "aa", "ab", "ac", "ad", "ae", "af", "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "ba", "bb", "bc", "bd", "be", "bf", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "ca", "cb", "cc", "cd", "ce", "cf", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "da", "db", "dc", "dd", "de", "df", "e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9", "ea", "eb", "ec", "ed", "ee", "ef", "f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "fa", "fb", "fc", "fd", "fe", "ff"],
    j = 1234567,
    q = Math.PI / 180,
    Z = 180 / Math.PI;

function K() {
    const t = 4294967295 * Math.random() | 0,
        e = 4294967295 * Math.random() | 0,
        n = 4294967295 * Math.random() | 0,
        i = 4294967295 * Math.random() | 0;
    return (Y[255 & t] + Y[t >> 8 & 255] + Y[t >> 16 & 255] + Y[t >> 24 & 255] + "-" + Y[255 & e] + Y[e >> 8 & 255] + "-" + Y[e >> 16 & 15 | 64] + Y[e >> 24 & 255] + "-" + Y[63 & n | 128] + Y[n >> 8 & 255] + "-" + Y[n >> 16 & 255] + Y[n >> 24 & 255] + Y[255 & i] + Y[i >> 8 & 255] + Y[i >> 16 & 255] + Y[i >> 24 & 255]).toLowerCase()
}

function J(t, e, n) {
    return Math.max(e, Math.min(n, t))
}

function $(t, e) {
    return (t % e + e) % e
}

function Q(t, e, n) {
    return (1 - n) * t + n * e
}

function tt(t, e) {
    switch (e.constructor) {
        case Float32Array:
            return t;
        case Uint32Array:
            return t / 4294967295;
        case Uint16Array:
            return t / 65535;
        case Uint8Array:
            return t / 255;
        case Int32Array:
            return Math.max(t / 2147483647, -1);
        case Int16Array:
            return Math.max(t / 32767, -1);
        case Int8Array:
            return Math.max(t / 127, -1);
        default:
            throw new Error("Invalid component type.")
    }
}

function et(t, e) {
    switch (e.constructor) {
        case Float32Array:
            return t;
        case Uint32Array:
            return Math.round(4294967295 * t);
        case Uint16Array:
            return Math.round(65535 * t);
        case Uint8Array:
            return Math.round(255 * t);
        case Int32Array:
            return Math.round(2147483647 * t);
        case Int16Array:
            return Math.round(32767 * t);
        case Int8Array:
            return Math.round(127 * t);
        default:
            throw new Error("Invalid component type.")
    }
}
var nt = {
        DEG2RAD: q,
        RAD2DEG: Z,
        generateUUID: K,
        clamp: J,
        euclideanModulo: $,
        mapLinear: function(t, e, n, i, a) {
            return i + (t - e) * (a - i) / (n - e)
        },
        inverseLerp: function(t, e, n) {
            return t !== e ? (n - t) / (e - t) : 0
        },
        lerp: Q,
        damp: function(t, e, n, i) {
            return Q(t, e, 1 - Math.exp(-n * i))
        },
        pingpong: function(t, e = 1) {
            return e - Math.abs($(t, 2 * e) - e)
        },
        smoothstep: function(t, e, n) {
            return t <= e ? 0 : t >= n ? 1 : (t = (t - e) / (n - e)) * t * (3 - 2 * t)
        },
        smootherstep: function(t, e, n) {
            return t <= e ? 0 : t >= n ? 1 : (t = (t - e) / (n - e)) * t * t * (t * (6 * t - 15) + 10)
        },
        randInt: function(t, e) {
            return t + Math.floor(Math.random() * (e - t + 1))
        },
        randFloat: function(t, e) {
            return t + Math.random() * (e - t)
        },
        randFloatSpread: function(t) {
            return t * (.5 - Math.random())
        },
        seededRandom: function(t) {
            void 0 !== t && (j = t);
            let e = j += 1831565813;
            return e = Math.imul(e ^ e >>> 15, 1 | e), e ^= e + Math.imul(e ^ e >>> 7, 61 | e), ((e ^ e >>> 14) >>> 0) / 4294967296
        },
        degToRad: function(t) {
            return t * q
        },
        radToDeg: function(t) {
            return t * Z
        },
        isPowerOfTwo: function(t) {
            return !(t & t - 1) && 0 !== t
        },
        ceilPowerOfTwo: function(t) {
            return Math.pow(2, Math.ceil(Math.log(t) / Math.LN2))
        },
        floorPowerOfTwo: function(t) {
            return Math.pow(2, Math.floor(Math.log(t) / Math.LN2))
        },
        setQuaternionFromProperEuler: function(t, e, n, i, a) {
            const r = Math.cos,
                s = Math.sin,
                o = r(n / 2),
                l = s(n / 2),
                c = r((e + i) / 2),
                h = s((e + i) / 2),
                u = r((e - i) / 2),
                d = s((e - i) / 2),
                p = r((i - e) / 2),
                m = s((i - e) / 2);
            switch (a) {
                case "XYX":
                    t.set(o * h, l * u, l * d, o * c);
                    break;
                case "YZY":
                    t.set(l * d, o * h, l * u, o * c);
                    break;
                case "ZXZ":
                    t.set(l * u, l * d, o * h, o * c);
                    break;
                case "XZX":
                    t.set(o * h, l * m, l * p, o * c);
                    break;
                case "YXY":
                    t.set(l * p, o * h, l * m, o * c);
                    break;
                case "ZYZ":
                    t.set(l * m, l * p, o * h, o * c);
                    break;
                default:
                    k("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: " + a)
            }
        },
        normalize: et,
        denormalize: tt
    },
    it = class t {
        constructor(e = 0, n = 0) {
            t.prototype.isVector2 = !0, this.x = e, this.y = n
        }
        get width() {
            return this.x
        }
        set width(t) {
            this.x = t
        }
        get height() {
            return this.y
        }
        set height(t) {
            this.y = t
        }
        set(t, e) {
            return this.x = t, this.y = e, this
        }
        setScalar(t) {
            return this.x = t, this.y = t, this
        }
        setX(t) {
            return this.x = t, this
        }
        setY(t) {
            return this.y = t, this
        }
        setComponent(t, e) {
            switch (t) {
                case 0:
                    this.x = e;
                    break;
                case 1:
                    this.y = e;
                    break;
                default:
                    throw new Error("index is out of range: " + t)
            }
            return this
        }
        getComponent(t) {
            switch (t) {
                case 0:
                    return this.x;
                case 1:
                    return this.y;
                default:
                    throw new Error("index is out of range: " + t)
            }
        }
        clone() {
            return new this.constructor(this.x, this.y)
        }
        copy(t) {
            return this.x = t.x, this.y = t.y, this
        }
        add(t) {
            return this.x += t.x, this.y += t.y, this
        }
        addScalar(t) {
            return this.x += t, this.y += t, this
        }
        addVectors(t, e) {
            return this.x = t.x + e.x, this.y = t.y + e.y, this
        }
        addScaledVector(t, e) {
            return this.x += t.x * e, this.y += t.y * e, this
        }
        sub(t) {
            return this.x -= t.x, this.y -= t.y, this
        }
        subScalar(t) {
            return this.x -= t, this.y -= t, this
        }
        subVectors(t, e) {
            return this.x = t.x - e.x, this.y = t.y - e.y, this
        }
        multiply(t) {
            return this.x *= t.x, this.y *= t.y, this
        }
        multiplyScalar(t) {
            return this.x *= t, this.y *= t, this
        }
        divide(t) {
            return this.x /= t.x, this.y /= t.y, this
        }
        divideScalar(t) {
            return this.multiplyScalar(1 / t)
        }
        applyMatrix3(t) {
            const e = this.x,
                n = this.y,
                i = t.elements;
            return this.x = i[0] * e + i[3] * n + i[6], this.y = i[1] * e + i[4] * n + i[7], this
        }
        min(t) {
            return this.x = Math.min(this.x, t.x), this.y = Math.min(this.y, t.y), this
        }
        max(t) {
            return this.x = Math.max(this.x, t.x), this.y = Math.max(this.y, t.y), this
        }
        clamp(t, e) {
            return this.x = J(this.x, t.x, e.x), this.y = J(this.y, t.y, e.y), this
        }
        clampScalar(t, e) {
            return this.x = J(this.x, t, e), this.y = J(this.y, t, e), this
        }
        clampLength(t, e) {
            const n = this.length();
            return this.divideScalar(n || 1).multiplyScalar(J(n, t, e))
        }
        floor() {
            return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this
        }
        ceil() {
            return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this
        }
        round() {
            return this.x = Math.round(this.x), this.y = Math.round(this.y), this
        }
        roundToZero() {
            return this.x = Math.trunc(this.x), this.y = Math.trunc(this.y), this
        }
        negate() {
            return this.x = -this.x, this.y = -this.y, this
        }
        dot(t) {
            return this.x * t.x + this.y * t.y
        }
        cross(t) {
            return this.x * t.y - this.y * t.x
        }
        lengthSq() {
            return this.x * this.x + this.y * this.y
        }
        length() {
            return Math.sqrt(this.x * this.x + this.y * this.y)
        }
        manhattanLength() {
            return Math.abs(this.x) + Math.abs(this.y)
        }
        normalize() {
            return this.divideScalar(this.length() || 1)
        }
        angle() {
            return Math.atan2(-this.y, -this.x) + Math.PI
        }
        angleTo(t) {
            const e = Math.sqrt(this.lengthSq() * t.lengthSq());
            if (0 === e) return Math.PI / 2;
            const n = this.dot(t) / e;
            return Math.acos(J(n, -1, 1))
        }
        distanceTo(t) {
            return Math.sqrt(this.distanceToSquared(t))
        }
        distanceToSquared(t) {
            const e = this.x - t.x,
                n = this.y - t.y;
            return e * e + n * n
        }
        manhattanDistanceTo(t) {
            return Math.abs(this.x - t.x) + Math.abs(this.y - t.y)
        }
        setLength(t) {
            return this.normalize().multiplyScalar(t)
        }
        lerp(t, e) {
            return this.x += (t.x - this.x) * e, this.y += (t.y - this.y) * e, this
        }
        lerpVectors(t, e, n) {
            return this.x = t.x + (e.x - t.x) * n, this.y = t.y + (e.y - t.y) * n, this
        }
        equals(t) {
            return t.x === this.x && t.y === this.y
        }
        fromArray(t, e = 0) {
            return this.x = t[e], this.y = t[e + 1], this
        }
        toArray(t = [], e = 0) {
            return t[e] = this.x, t[e + 1] = this.y, t
        }
        fromBufferAttribute(t, e) {
            return this.x = t.getX(e), this.y = t.getY(e), this
        }
        rotateAround(t, e) {
            const n = Math.cos(e),
                i = Math.sin(e),
                a = this.x - t.x,
                r = this.y - t.y;
            return this.x = a * n - r * i + t.x, this.y = a * i + r * n + t.y, this
        }
        random() {
            return this.x = Math.random(), this.y = Math.random(), this
        }*[Symbol.iterator]() {
            yield this.x, yield this.y
        }
    },
    at = class {
        constructor(t = 0, e = 0, n = 0, i = 1) {
            this.isQuaternion = !0, this._x = t, this._y = e, this._z = n, this._w = i
        }
        static slerpFlat(t, e, n, i, a, r, s) {
            let o = n[i + 0],
                l = n[i + 1],
                c = n[i + 2],
                h = n[i + 3],
                u = a[r + 0],
                d = a[r + 1],
                p = a[r + 2],
                m = a[r + 3];
            if (h !== m || o !== u || l !== d || c !== p) {
                let t = o * u + l * d + c * p + h * m;
                t < 0 && (u = -u, d = -d, p = -p, m = -m, t = -t);
                let e = 1 - s;
                if (t < .9995) {
                    const n = Math.acos(t),
                        i = Math.sin(n);
                    e = Math.sin(e * n) / i, o = o * e + u * (s = Math.sin(s * n) / i), l = l * e + d * s, c = c * e + p * s, h = h * e + m * s
                } else {
                    o = o * e + u * s, l = l * e + d * s, c = c * e + p * s, h = h * e + m * s;
                    const t = 1 / Math.sqrt(o * o + l * l + c * c + h * h);
                    o *= t, l *= t, c *= t, h *= t
                }
            }
            t[e] = o, t[e + 1] = l, t[e + 2] = c, t[e + 3] = h
        }
        static multiplyQuaternionsFlat(t, e, n, i, a, r) {
            const s = n[i],
                o = n[i + 1],
                l = n[i + 2],
                c = n[i + 3],
                h = a[r],
                u = a[r + 1],
                d = a[r + 2],
                p = a[r + 3];
            return t[e] = s * p + c * h + o * d - l * u, t[e + 1] = o * p + c * u + l * h - s * d, t[e + 2] = l * p + c * d + s * u - o * h, t[e + 3] = c * p - s * h - o * u - l * d, t
        }
        get x() {
            return this._x
        }
        set x(t) {
            this._x = t, this._onChangeCallback()
        }
        get y() {
            return this._y
        }
        set y(t) {
            this._y = t, this._onChangeCallback()
        }
        get z() {
            return this._z
        }
        set z(t) {
            this._z = t, this._onChangeCallback()
        }
        get w() {
            return this._w
        }
        set w(t) {
            this._w = t, this._onChangeCallback()
        }
        set(t, e, n, i) {
            return this._x = t, this._y = e, this._z = n, this._w = i, this._onChangeCallback(), this
        }
        clone() {
            return new this.constructor(this._x, this._y, this._z, this._w)
        }
        copy(t) {
            return this._x = t.x, this._y = t.y, this._z = t.z, this._w = t.w, this._onChangeCallback(), this
        }
        setFromEuler(t, e = !0) {
            const n = t._x,
                i = t._y,
                a = t._z,
                r = t._order,
                s = Math.cos,
                o = Math.sin,
                l = s(n / 2),
                c = s(i / 2),
                h = s(a / 2),
                u = o(n / 2),
                d = o(i / 2),
                p = o(a / 2);
            switch (r) {
                case "XYZ":
                    this._x = u * c * h + l * d * p, this._y = l * d * h - u * c * p, this._z = l * c * p + u * d * h, this._w = l * c * h - u * d * p;
                    break;
                case "YXZ":
                    this._x = u * c * h + l * d * p, this._y = l * d * h - u * c * p, this._z = l * c * p - u * d * h, this._w = l * c * h + u * d * p;
                    break;
                case "ZXY":
                    this._x = u * c * h - l * d * p, this._y = l * d * h + u * c * p, this._z = l * c * p + u * d * h, this._w = l * c * h - u * d * p;
                    break;
                case "ZYX":
                    this._x = u * c * h - l * d * p, this._y = l * d * h + u * c * p, this._z = l * c * p - u * d * h, this._w = l * c * h + u * d * p;
                    break;
                case "YZX":
                    this._x = u * c * h + l * d * p, this._y = l * d * h + u * c * p, this._z = l * c * p - u * d * h, this._w = l * c * h - u * d * p;
                    break;
                case "XZY":
                    this._x = u * c * h - l * d * p, this._y = l * d * h - u * c * p, this._z = l * c * p + u * d * h, this._w = l * c * h + u * d * p;
                    break;
                default:
                    k("Quaternion: .setFromEuler() encountered an unknown order: " + r)
            }
            return !0 === e && this._onChangeCallback(), this
        }
        setFromAxisAngle(t, e) {
            const n = e / 2,
                i = Math.sin(n);
            return this._x = t.x * i, this._y = t.y * i, this._z = t.z * i, this._w = Math.cos(n), this._onChangeCallback(), this
        }
        setFromRotationMatrix(t) {
            const e = t.elements,
                n = e[0],
                i = e[4],
                a = e[8],
                r = e[1],
                s = e[5],
                o = e[9],
                l = e[2],
                c = e[6],
                h = e[10],
                u = n + s + h;
            if (u > 0) {
                const t = .5 / Math.sqrt(u + 1);
                this._w = .25 / t, this._x = (c - o) * t, this._y = (a - l) * t, this._z = (r - i) * t
            } else if (n > s && n > h) {
                const t = 2 * Math.sqrt(1 + n - s - h);
                this._w = (c - o) / t, this._x = .25 * t, this._y = (i + r) / t, this._z = (a + l) / t
            } else if (s > h) {
                const t = 2 * Math.sqrt(1 + s - n - h);
                this._w = (a - l) / t, this._x = (i + r) / t, this._y = .25 * t, this._z = (o + c) / t
            } else {
                const t = 2 * Math.sqrt(1 + h - n - s);
                this._w = (r - i) / t, this._x = (a + l) / t, this._y = (o + c) / t, this._z = .25 * t
            }
            return this._onChangeCallback(), this
        }
        setFromUnitVectors(t, e) {
            let n = t.dot(e) + 1;
            return n < 1e-8 ? (n = 0, Math.abs(t.x) > Math.abs(t.z) ? (this._x = -t.y, this._y = t.x, this._z = 0, this._w = n) : (this._x = 0, this._y = -t.z, this._z = t.y, this._w = n)) : (this._x = t.y * e.z - t.z * e.y, this._y = t.z * e.x - t.x * e.z, this._z = t.x * e.y - t.y * e.x, this._w = n), this.normalize()
        }
        angleTo(t) {
            return 2 * Math.acos(Math.abs(J(this.dot(t), -1, 1)))
        }
        rotateTowards(t, e) {
            const n = this.angleTo(t);
            if (0 === n) return this;
            const i = Math.min(1, e / n);
            return this.slerp(t, i), this
        }
        identity() {
            return this.set(0, 0, 0, 1)
        }
        invert() {
            return this.conjugate()
        }
        conjugate() {
            return this._x *= -1, this._y *= -1, this._z *= -1, this._onChangeCallback(), this
        }
        dot(t) {
            return this._x * t._x + this._y * t._y + this._z * t._z + this._w * t._w
        }
        lengthSq() {
            return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w
        }
        length() {
            return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w)
        }
        normalize() {
            let t = this.length();
            return 0 === t ? (this._x = 0, this._y = 0, this._z = 0, this._w = 1) : (t = 1 / t, this._x = this._x * t, this._y = this._y * t, this._z = this._z * t, this._w = this._w * t), this._onChangeCallback(), this
        }
        multiply(t) {
            return this.multiplyQuaternions(this, t)
        }
        premultiply(t) {
            return this.multiplyQuaternions(t, this)
        }
        multiplyQuaternions(t, e) {
            const n = t._x,
                i = t._y,
                a = t._z,
                r = t._w,
                s = e._x,
                o = e._y,
                l = e._z,
                c = e._w;
            return this._x = n * c + r * s + i * l - a * o, this._y = i * c + r * o + a * s - n * l, this._z = a * c + r * l + n * o - i * s, this._w = r * c - n * s - i * o - a * l, this._onChangeCallback(), this
        }
        slerp(t, e) {
            let n = t._x,
                i = t._y,
                a = t._z,
                r = t._w,
                s = this.dot(t);
            s < 0 && (n = -n, i = -i, a = -a, r = -r, s = -s);
            let o = 1 - e;
            if (s < .9995) {
                const t = Math.acos(s),
                    l = Math.sin(t);
                o = Math.sin(o * t) / l, e = Math.sin(e * t) / l, this._x = this._x * o + n * e, this._y = this._y * o + i * e, this._z = this._z * o + a * e, this._w = this._w * o + r * e, this._onChangeCallback()
            } else this._x = this._x * o + n * e, this._y = this._y * o + i * e, this._z = this._z * o + a * e, this._w = this._w * o + r * e, this.normalize();
            return this
        }
        slerpQuaternions(t, e, n) {
            return this.copy(t).slerp(e, n)
        }
        random() {
            const t = 2 * Math.PI * Math.random(),
                e = 2 * Math.PI * Math.random(),
                n = Math.random(),
                i = Math.sqrt(1 - n),
                a = Math.sqrt(n);
            return this.set(i * Math.sin(t), i * Math.cos(t), a * Math.sin(e), a * Math.cos(e))
        }
        equals(t) {
            return t._x === this._x && t._y === this._y && t._z === this._z && t._w === this._w
        }
        fromArray(t, e = 0) {
            return this._x = t[e], this._y = t[e + 1], this._z = t[e + 2], this._w = t[e + 3], this._onChangeCallback(), this
        }
        toArray(t = [], e = 0) {
            return t[e] = this._x, t[e + 1] = this._y, t[e + 2] = this._z, t[e + 3] = this._w, t
        }
        fromBufferAttribute(t, e) {
            return this._x = t.getX(e), this._y = t.getY(e), this._z = t.getZ(e), this._w = t.getW(e), this._onChangeCallback(), this
        }
        toJSON() {
            return this.toArray()
        }
        _onChange(t) {
            return this._onChangeCallback = t, this
        }
        _onChangeCallback() {}*[Symbol.iterator]() {
            yield this._x, yield this._y, yield this._z, yield this._w
        }
    },
    rt = class t {
        constructor(e = 0, n = 0, i = 0) {
            t.prototype.isVector3 = !0, this.x = e, this.y = n, this.z = i
        }
        set(t, e, n) {
            return void 0 === n && (n = this.z), this.x = t, this.y = e, this.z = n, this
        }
        setScalar(t) {
            return this.x = t, this.y = t, this.z = t, this
        }
        setX(t) {
            return this.x = t, this
        }
        setY(t) {
            return this.y = t, this
        }
        setZ(t) {
            return this.z = t, this
        }
        setComponent(t, e) {
            switch (t) {
                case 0:
                    this.x = e;
                    break;
                case 1:
                    this.y = e;
                    break;
                case 2:
                    this.z = e;
                    break;
                default:
                    throw new Error("index is out of range: " + t)
            }
            return this
        }
        getComponent(t) {
            switch (t) {
                case 0:
                    return this.x;
                case 1:
                    return this.y;
                case 2:
                    return this.z;
                default:
                    throw new Error("index is out of range: " + t)
            }
        }
        clone() {
            return new this.constructor(this.x, this.y, this.z)
        }
        copy(t) {
            return this.x = t.x, this.y = t.y, this.z = t.z, this
        }
        add(t) {
            return this.x += t.x, this.y += t.y, this.z += t.z, this
        }
        addScalar(t) {
            return this.x += t, this.y += t, this.z += t, this
        }
        addVectors(t, e) {
            return this.x = t.x + e.x, this.y = t.y + e.y, this.z = t.z + e.z, this
        }
        addScaledVector(t, e) {
            return this.x += t.x * e, this.y += t.y * e, this.z += t.z * e, this
        }
        sub(t) {
            return this.x -= t.x, this.y -= t.y, this.z -= t.z, this
        }
        subScalar(t) {
            return this.x -= t, this.y -= t, this.z -= t, this
        }
        subVectors(t, e) {
            return this.x = t.x - e.x, this.y = t.y - e.y, this.z = t.z - e.z, this
        }
        multiply(t) {
            return this.x *= t.x, this.y *= t.y, this.z *= t.z, this
        }
        multiplyScalar(t) {
            return this.x *= t, this.y *= t, this.z *= t, this
        }
        multiplyVectors(t, e) {
            return this.x = t.x * e.x, this.y = t.y * e.y, this.z = t.z * e.z, this
        }
        applyEuler(t) {
            return this.applyQuaternion(ot.setFromEuler(t))
        }
        applyAxisAngle(t, e) {
            return this.applyQuaternion(ot.setFromAxisAngle(t, e))
        }
        applyMatrix3(t) {
            const e = this.x,
                n = this.y,
                i = this.z,
                a = t.elements;
            return this.x = a[0] * e + a[3] * n + a[6] * i, this.y = a[1] * e + a[4] * n + a[7] * i, this.z = a[2] * e + a[5] * n + a[8] * i, this
        }
        applyNormalMatrix(t) {
            return this.applyMatrix3(t).normalize()
        }
        applyMatrix4(t) {
            const e = this.x,
                n = this.y,
                i = this.z,
                a = t.elements,
                r = 1 / (a[3] * e + a[7] * n + a[11] * i + a[15]);
            return this.x = (a[0] * e + a[4] * n + a[8] * i + a[12]) * r, this.y = (a[1] * e + a[5] * n + a[9] * i + a[13]) * r, this.z = (a[2] * e + a[6] * n + a[10] * i + a[14]) * r, this
        }
        applyQuaternion(t) {
            const e = this.x,
                n = this.y,
                i = this.z,
                a = t.x,
                r = t.y,
                s = t.z,
                o = t.w,
                l = 2 * (r * i - s * n),
                c = 2 * (s * e - a * i),
                h = 2 * (a * n - r * e);
            return this.x = e + o * l + r * h - s * c, this.y = n + o * c + s * l - a * h, this.z = i + o * h + a * c - r * l, this
        }
        project(t) {
            return this.applyMatrix4(t.matrixWorldInverse).applyMatrix4(t.projectionMatrix)
        }
        unproject(t) {
            return this.applyMatrix4(t.projectionMatrixInverse).applyMatrix4(t.matrixWorld)
        }
        transformDirection(t) {
            const e = this.x,
                n = this.y,
                i = this.z,
                a = t.elements;
            return this.x = a[0] * e + a[4] * n + a[8] * i, this.y = a[1] * e + a[5] * n + a[9] * i, this.z = a[2] * e + a[6] * n + a[10] * i, this.normalize()
        }
        divide(t) {
            return this.x /= t.x, this.y /= t.y, this.z /= t.z, this
        }
        divideScalar(t) {
            return this.multiplyScalar(1 / t)
        }
        min(t) {
            return this.x = Math.min(this.x, t.x), this.y = Math.min(this.y, t.y), this.z = Math.min(this.z, t.z), this
        }
        max(t) {
            return this.x = Math.max(this.x, t.x), this.y = Math.max(this.y, t.y), this.z = Math.max(this.z, t.z), this
        }
        clamp(t, e) {
            return this.x = J(this.x, t.x, e.x), this.y = J(this.y, t.y, e.y), this.z = J(this.z, t.z, e.z), this
        }
        clampScalar(t, e) {
            return this.x = J(this.x, t, e), this.y = J(this.y, t, e), this.z = J(this.z, t, e), this
        }
        clampLength(t, e) {
            const n = this.length();
            return this.divideScalar(n || 1).multiplyScalar(J(n, t, e))
        }
        floor() {
            return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this.z = Math.floor(this.z), this
        }
        ceil() {
            return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this.z = Math.ceil(this.z), this
        }
        round() {
            return this.x = Math.round(this.x), this.y = Math.round(this.y), this.z = Math.round(this.z), this
        }
        roundToZero() {
            return this.x = Math.trunc(this.x), this.y = Math.trunc(this.y), this.z = Math.trunc(this.z), this
        }
        negate() {
            return this.x = -this.x, this.y = -this.y, this.z = -this.z, this
        }
        dot(t) {
            return this.x * t.x + this.y * t.y + this.z * t.z
        }
        lengthSq() {
            return this.x * this.x + this.y * this.y + this.z * this.z
        }
        length() {
            return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
        }
        manhattanLength() {
            return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z)
        }
        normalize() {
            return this.divideScalar(this.length() || 1)
        }
        setLength(t) {
            return this.normalize().multiplyScalar(t)
        }
        lerp(t, e) {
            return this.x += (t.x - this.x) * e, this.y += (t.y - this.y) * e, this.z += (t.z - this.z) * e, this
        }
        lerpVectors(t, e, n) {
            return this.x = t.x + (e.x - t.x) * n, this.y = t.y + (e.y - t.y) * n, this.z = t.z + (e.z - t.z) * n, this
        }
        cross(t) {
            return this.crossVectors(this, t)
        }
        crossVectors(t, e) {
            const n = t.x,
                i = t.y,
                a = t.z,
                r = e.x,
                s = e.y,
                o = e.z;
            return this.x = i * o - a * s, this.y = a * r - n * o, this.z = n * s - i * r, this
        }
        projectOnVector(t) {
            const e = t.lengthSq();
            if (0 === e) return this.set(0, 0, 0);
            const n = t.dot(this) / e;
            return this.copy(t).multiplyScalar(n)
        }
        projectOnPlane(t) {
            return st.copy(this).projectOnVector(t), this.sub(st)
        }
        reflect(t) {
            return this.sub(st.copy(t).multiplyScalar(2 * this.dot(t)))
        }
        angleTo(t) {
            const e = Math.sqrt(this.lengthSq() * t.lengthSq());
            if (0 === e) return Math.PI / 2;
            const n = this.dot(t) / e;
            return Math.acos(J(n, -1, 1))
        }
        distanceTo(t) {
            return Math.sqrt(this.distanceToSquared(t))
        }
        distanceToSquared(t) {
            const e = this.x - t.x,
                n = this.y - t.y,
                i = this.z - t.z;
            return e * e + n * n + i * i
        }
        manhattanDistanceTo(t) {
            return Math.abs(this.x - t.x) + Math.abs(this.y - t.y) + Math.abs(this.z - t.z)
        }
        setFromSpherical(t) {
            return this.setFromSphericalCoords(t.radius, t.phi, t.theta)
        }
        setFromSphericalCoords(t, e, n) {
            const i = Math.sin(e) * t;
            return this.x = i * Math.sin(n), this.y = Math.cos(e) * t, this.z = i * Math.cos(n), this
        }
        setFromCylindrical(t) {
            return this.setFromCylindricalCoords(t.radius, t.theta, t.y)
        }
        setFromCylindricalCoords(t, e, n) {
            return this.x = t * Math.sin(e), this.y = n, this.z = t * Math.cos(e), this
        }
        setFromMatrixPosition(t) {
            const e = t.elements;
            return this.x = e[12], this.y = e[13], this.z = e[14], this
        }
        setFromMatrixScale(t) {
            const e = this.setFromMatrixColumn(t, 0).length(),
                n = this.setFromMatrixColumn(t, 1).length(),
                i = this.setFromMatrixColumn(t, 2).length();
            return this.x = e, this.y = n, this.z = i, this
        }
        setFromMatrixColumn(t, e) {
            return this.fromArray(t.elements, 4 * e)
        }
        setFromMatrix3Column(t, e) {
            return this.fromArray(t.elements, 3 * e)
        }
        setFromEuler(t) {
            return this.x = t._x, this.y = t._y, this.z = t._z, this
        }
        setFromColor(t) {
            return this.x = t.r, this.y = t.g, this.z = t.b, this
        }
        equals(t) {
            return t.x === this.x && t.y === this.y && t.z === this.z
        }
        fromArray(t, e = 0) {
            return this.x = t[e], this.y = t[e + 1], this.z = t[e + 2], this
        }
        toArray(t = [], e = 0) {
            return t[e] = this.x, t[e + 1] = this.y, t[e + 2] = this.z, t
        }
        fromBufferAttribute(t, e) {
            return this.x = t.getX(e), this.y = t.getY(e), this.z = t.getZ(e), this
        }
        random() {
            return this.x = Math.random(), this.y = Math.random(), this.z = Math.random(), this
        }
        randomDirection() {
            const t = Math.random() * Math.PI * 2,
                e = 2 * Math.random() - 1,
                n = Math.sqrt(1 - e * e);
            return this.x = n * Math.cos(t), this.y = e, this.z = n * Math.sin(t), this
        }*[Symbol.iterator]() {
            yield this.x, yield this.y, yield this.z
        }
    },
    st = new rt,
    ot = new at,
    lt = class t {
        constructor(e, n, i, a, r, s, o, l, c) {
            t.prototype.isMatrix3 = !0, this.elements = [1, 0, 0, 0, 1, 0, 0, 0, 1], void 0 !== e && this.set(e, n, i, a, r, s, o, l, c)
        }
        set(t, e, n, i, a, r, s, o, l) {
            const c = this.elements;
            return c[0] = t, c[1] = i, c[2] = s, c[3] = e, c[4] = a, c[5] = o, c[6] = n, c[7] = r, c[8] = l, this
        }
        identity() {
            return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1), this
        }
        copy(t) {
            const e = this.elements,
                n = t.elements;
            return e[0] = n[0], e[1] = n[1], e[2] = n[2], e[3] = n[3], e[4] = n[4], e[5] = n[5], e[6] = n[6], e[7] = n[7], e[8] = n[8], this
        }
        extractBasis(t, e, n) {
            return t.setFromMatrix3Column(this, 0), e.setFromMatrix3Column(this, 1), n.setFromMatrix3Column(this, 2), this
        }
        setFromMatrix4(t) {
            const e = t.elements;
            return this.set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]), this
        }
        multiply(t) {
            return this.multiplyMatrices(this, t)
        }
        premultiply(t) {
            return this.multiplyMatrices(t, this)
        }
        multiplyMatrices(t, e) {
            const n = t.elements,
                i = e.elements,
                a = this.elements,
                r = n[0],
                s = n[3],
                o = n[6],
                l = n[1],
                c = n[4],
                h = n[7],
                u = n[2],
                d = n[5],
                p = n[8],
                m = i[0],
                f = i[3],
                g = i[6],
                _ = i[1],
                v = i[4],
                x = i[7],
                M = i[2],
                b = i[5],
                y = i[8];
            return a[0] = r * m + s * _ + o * M, a[3] = r * f + s * v + o * b, a[6] = r * g + s * x + o * y, a[1] = l * m + c * _ + h * M, a[4] = l * f + c * v + h * b, a[7] = l * g + c * x + h * y, a[2] = u * m + d * _ + p * M, a[5] = u * f + d * v + p * b, a[8] = u * g + d * x + p * y, this
        }
        multiplyScalar(t) {
            const e = this.elements;
            return e[0] *= t, e[3] *= t, e[6] *= t, e[1] *= t, e[4] *= t, e[7] *= t, e[2] *= t, e[5] *= t, e[8] *= t, this
        }
        determinant() {
            const t = this.elements,
                e = t[0],
                n = t[1],
                i = t[2],
                a = t[3],
                r = t[4],
                s = t[5],
                o = t[6],
                l = t[7],
                c = t[8];
            return e * r * c - e * s * l - n * a * c + n * s * o + i * a * l - i * r * o
        }
        invert() {
            const t = this.elements,
                e = t[0],
                n = t[1],
                i = t[2],
                a = t[3],
                r = t[4],
                s = t[5],
                o = t[6],
                l = t[7],
                c = t[8],
                h = c * r - s * l,
                u = s * o - c * a,
                d = l * a - r * o,
                p = e * h + n * u + i * d;
            if (0 === p) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0);
            const m = 1 / p;
            return t[0] = h * m, t[1] = (i * l - c * n) * m, t[2] = (s * n - i * r) * m, t[3] = u * m, t[4] = (c * e - i * o) * m, t[5] = (i * a - s * e) * m, t[6] = d * m, t[7] = (n * o - l * e) * m, t[8] = (r * e - n * a) * m, this
        }
        transpose() {
            let t;
            const e = this.elements;
            return t = e[1], e[1] = e[3], e[3] = t, t = e[2], e[2] = e[6], e[6] = t, t = e[5], e[5] = e[7], e[7] = t, this
        }
        getNormalMatrix(t) {
            return this.setFromMatrix4(t).invert().transpose()
        }
        transposeIntoArray(t) {
            const e = this.elements;
            return t[0] = e[0], t[1] = e[3], t[2] = e[6], t[3] = e[1], t[4] = e[4], t[5] = e[7], t[6] = e[2], t[7] = e[5], t[8] = e[8], this
        }
        setUvTransform(t, e, n, i, a, r, s) {
            const o = Math.cos(a),
                l = Math.sin(a);
            return this.set(n * o, n * l, -n * (o * r + l * s) + r + t, -i * l, i * o, -i * (-l * r + o * s) + s + e, 0, 0, 1), this
        }
        scale(t, e) {
            return this.premultiply(ct.makeScale(t, e)), this
        }
        rotate(t) {
            return this.premultiply(ct.makeRotation(-t)), this
        }
        translate(t, e) {
            return this.premultiply(ct.makeTranslation(t, e)), this
        }
        makeTranslation(t, e) {
            return t.isVector2 ? this.set(1, 0, t.x, 0, 1, t.y, 0, 0, 1) : this.set(1, 0, t, 0, 1, e, 0, 0, 1), this
        }
        makeRotation(t) {
            const e = Math.cos(t),
                n = Math.sin(t);
            return this.set(e, -n, 0, n, e, 0, 0, 0, 1), this
        }
        makeScale(t, e) {
            return this.set(t, 0, 0, 0, e, 0, 0, 0, 1), this
        }
        equals(t) {
            const e = this.elements,
                n = t.elements;
            for (let i = 0; i < 9; i++)
                if (e[i] !== n[i]) return !1;
            return !0
        }
        fromArray(t, e = 0) {
            for (let n = 0; n < 9; n++) this.elements[n] = t[n + e];
            return this
        }
        toArray(t = [], e = 0) {
            const n = this.elements;
            return t[e] = n[0], t[e + 1] = n[1], t[e + 2] = n[2], t[e + 3] = n[3], t[e + 4] = n[4], t[e + 5] = n[5], t[e + 6] = n[6], t[e + 7] = n[7], t[e + 8] = n[8], t
        }
        clone() {
            return (new this.constructor).fromArray(this.elements)
        }
    },
    ct = new lt,
    ht = (new lt).set(.4123908, .3575843, .1804808, .212639, .7151687, .0721923, .0193308, .1191948, .9505322),
    ut = (new lt).set(3.2409699, -1.5373832, -.4986108, -.9692436, 1.8759675, .0415551, .0556301, -.203977, 1.0569715);

function dt() {
    const t = {
            enabled: !0,
            workingColorSpace: D,
            spaces: {},
            convert: function(t, e, n) {
                return !1 !== this.enabled && e !== n && e && n ? ("srgb" === this.spaces[e].transfer && (t.r = ft(t.r), t.g = ft(t.g), t.b = ft(t.b)), this.spaces[e].primaries !== this.spaces[n].primaries && (t.applyMatrix3(this.spaces[e].toXYZ), t.applyMatrix3(this.spaces[n].fromXYZ)), "srgb" === this.spaces[n].transfer && (t.r = gt(t.r), t.g = gt(t.g), t.b = gt(t.b)), t) : t
            },
            workingToColorSpace: function(t, e) {
                return this.convert(t, this.workingColorSpace, e)
            },
            colorSpaceToWorking: function(t, e) {
                return this.convert(t, e, this.workingColorSpace)
            },
            getPrimaries: function(t) {
                return this.spaces[t].primaries
            },
            getTransfer: function(t) {
                return "" === t ? L : this.spaces[t].transfer
            },
            getToneMappingMode: function(t) {
                return this.spaces[t].outputColorSpaceConfig.toneMappingMode || "standard"
            },
            getLuminanceCoefficients: function(t, e = this.workingColorSpace) {
                return t.fromArray(this.spaces[e].luminanceCoefficients)
            },
            define: function(t) {
                Object.assign(this.spaces, t)
            },
            _getMatrix: function(t, e, n) {
                return t.copy(this.spaces[e].toXYZ).multiply(this.spaces[n].fromXYZ)
            },
            _getDrawingBufferColorSpace: function(t) {
                return this.spaces[t].outputColorSpaceConfig.drawingBufferColorSpace
            },
            _getUnpackColorSpace: function(t = this.workingColorSpace) {
                return this.spaces[t].workingColorSpaceConfig.unpackColorSpace
            },
            fromWorkingColorSpace: function(e, n) {
                return G("ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."), t.workingToColorSpace(e, n)
            },
            toWorkingColorSpace: function(e, n) {
                return G("ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."), t.colorSpaceToWorking(e, n)
            }
        },
        e = [.64, .33, .3, .6, .15, .06],
        n = [.2126, .7152, .0722],
        i = [.3127, .329];
    return t.define({
        [D]: {
            primaries: e,
            whitePoint: i,
            transfer: L,
            toXYZ: ht,
            fromXYZ: ut,
            luminanceCoefficients: n,
            workingColorSpaceConfig: {
                unpackColorSpace: P
            },
            outputColorSpaceConfig: {
                drawingBufferColorSpace: P
            }
        },
        [P]: {
            primaries: e,
            whitePoint: i,
            transfer: I,
            toXYZ: ht,
            fromXYZ: ut,
            luminanceCoefficients: n,
            outputColorSpaceConfig: {
                drawingBufferColorSpace: P
            }
        }
    }), t
}
var pt, mt = dt();

function ft(t) {
    return t < .04045 ? .0773993808 * t : Math.pow(.9478672986 * t + .0521327014, 2.4)
}

function gt(t) {
    return t < .0031308 ? 12.92 * t : 1.055 * Math.pow(t, .41666) - .055
}
var _t = class {
        static getDataURL(t, e = "image/png") {
            if (/^data:/i.test(t.src)) return t.src;
            if ("undefined" == typeof HTMLCanvasElement) return t.src;
            let n;
            if (t instanceof HTMLCanvasElement) n = t;
            else {
                void 0 === pt && (pt = O("canvas")), pt.width = t.width, pt.height = t.height;
                const e = pt.getContext("2d");
                t instanceof ImageData ? e.putImageData(t, 0, 0) : e.drawImage(t, 0, 0, t.width, t.height), n = pt
            }
            return n.toDataURL(e)
        }
        static sRGBToLinear(t) {
            if ("undefined" != typeof HTMLImageElement && t instanceof HTMLImageElement || "undefined" != typeof HTMLCanvasElement && t instanceof HTMLCanvasElement || "undefined" != typeof ImageBitmap && t instanceof ImageBitmap) {
                const e = O("canvas");
                e.width = t.width, e.height = t.height;
                const n = e.getContext("2d");
                n.drawImage(t, 0, 0, t.width, t.height);
                const i = n.getImageData(0, 0, t.width, t.height),
                    a = i.data;
                for (let t = 0; t < a.length; t++) a[t] = 255 * ft(a[t] / 255);
                return n.putImageData(i, 0, 0), e
            }
            if (t.data) {
                const e = t.data.slice(0);
                for (let t = 0; t < e.length; t++) e instanceof Uint8Array || e instanceof Uint8ClampedArray ? e[t] = Math.floor(255 * ft(e[t] / 255)) : e[t] = ft(e[t]);
                return {
                    data: e,
                    width: t.width,
                    height: t.height
                }
            }
            return k("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."), t
        }
    },
    vt = 0,
    xt = class {
        constructor(t = null) {
            this.isSource = !0, Object.defineProperty(this, "id", {
                value: vt++
            }), this.uuid = K(), this.data = t, this.dataReady = !0, this.version = 0
        }
        getSize(t) {
            const e = this.data;
            return "undefined" != typeof HTMLVideoElement && e instanceof HTMLVideoElement ? t.set(e.videoWidth, e.videoHeight, 0) : "undefined" != typeof VideoFrame && e instanceof VideoFrame ? t.set(e.displayHeight, e.displayWidth, 0) : null !== e ? t.set(e.width, e.height, e.depth || 0) : t.set(0, 0, 0), t
        }
        set needsUpdate(t) {
            !0 === t && this.version++
        }
        toJSON(t) {
            const e = void 0 === t || "string" == typeof t;
            if (!e && void 0 !== t.images[this.uuid]) return t.images[this.uuid];
            const n = {
                    uuid: this.uuid,
                    url: ""
                },
                i = this.data;
            if (null !== i) {
                let t;
                if (Array.isArray(i)) {
                    t = [];
                    for (let e = 0, n = i.length; e < n; e++) i[e].isDataTexture ? t.push(Mt(i[e].image)) : t.push(Mt(i[e]))
                } else t = Mt(i);
                n.url = t
            }
            return e || (t.images[this.uuid] = n), n
        }
    };

function Mt(t) {
    return "undefined" != typeof HTMLImageElement && t instanceof HTMLImageElement || "undefined" != typeof HTMLCanvasElement && t instanceof HTMLCanvasElement || "undefined" != typeof ImageBitmap && t instanceof ImageBitmap ? _t.getDataURL(t) : t.data ? {
        data: Array.from(t.data),
        width: t.width,
        height: t.height,
        type: t.data.constructor.name
    } : (k("Texture: Unable to serialize Texture."), {})
}
var bt = 0,
    yt = new rt,
    St = class t extends X {
        constructor(e = t.DEFAULT_IMAGE, n = t.DEFAULT_MAPPING, i = 1001, a = 1001, r = 1006, s = 1008, o = 1023, l = _, c = t.DEFAULT_ANISOTROPY, h = "") {
            super(), this.isTexture = !0, Object.defineProperty(this, "id", {
                value: bt++
            }), this.uuid = K(), this.name = "", this.source = new xt(e), this.mipmaps = [], this.mapping = n, this.channel = 0, this.wrapS = i, this.wrapT = a, this.magFilter = r, this.minFilter = s, this.anisotropy = c, this.format = o, this.internalFormat = null, this.type = l, this.offset = new it(0, 0), this.repeat = new it(1, 1), this.center = new it(0, 0), this.rotation = 0, this.matrixAutoUpdate = !0, this.matrix = new lt, this.generateMipmaps = !0, this.premultiplyAlpha = !1, this.flipY = !0, this.unpackAlignment = 4, this.colorSpace = h, this.userData = {}, this.updateRanges = [], this.version = 0, this.onUpdate = null, this.renderTarget = null, this.isRenderTargetTexture = !1, this.isArrayTexture = !!(e && e.depth && e.depth > 1), this.pmremVersion = 0
        }
        get width() {
            return this.source.getSize(yt).x
        }
        get height() {
            return this.source.getSize(yt).y
        }
        get depth() {
            return this.source.getSize(yt).z
        }
        get image() {
            return this.source.data
        }
        set image(t = null) {
            this.source.data = t
        }
        updateMatrix() {
            this.matrix.setUvTransform(this.offset.x, this.offset.y, this.repeat.x, this.repeat.y, this.rotation, this.center.x, this.center.y)
        }
        addUpdateRange(t, e) {
            this.updateRanges.push({
                start: t,
                count: e
            })
        }
        clearUpdateRanges() {
            this.updateRanges.length = 0
        }
        clone() {
            return (new this.constructor).copy(this)
        }
        copy(t) {
            return this.name = t.name, this.source = t.source, this.mipmaps = t.mipmaps.slice(0), this.mapping = t.mapping, this.channel = t.channel, this.wrapS = t.wrapS, this.wrapT = t.wrapT, this.magFilter = t.magFilter, this.minFilter = t.minFilter, this.anisotropy = t.anisotropy, this.format = t.format, this.internalFormat = t.internalFormat, this.type = t.type, this.offset.copy(t.offset), this.repeat.copy(t.repeat), this.center.copy(t.center), this.rotation = t.rotation, this.matrixAutoUpdate = t.matrixAutoUpdate, this.matrix.copy(t.matrix), this.generateMipmaps = t.generateMipmaps, this.premultiplyAlpha = t.premultiplyAlpha, this.flipY = t.flipY, this.unpackAlignment = t.unpackAlignment, this.colorSpace = t.colorSpace, this.renderTarget = t.renderTarget, this.isRenderTargetTexture = t.isRenderTargetTexture, this.isArrayTexture = t.isArrayTexture, this.userData = JSON.parse(JSON.stringify(t.userData)), this.needsUpdate = !0, this
        }
        setValues(t) {
            for (const e in t) {
                const n = t[e];
                if (void 0 === n) {
                    k(`Texture.setValues(): parameter '${e}' has value of undefined.`);
                    continue
                }
                const i = this[e];
                void 0 !== i ? i && n && i.isVector2 && n.isVector2 || i && n && i.isVector3 && n.isVector3 || i && n && i.isMatrix3 && n.isMatrix3 ? i.copy(n) : this[e] = n : k(`Texture.setValues(): property '${e}' does not exist.`)
            }
        }
        toJSON(t) {
            const e = void 0 === t || "string" == typeof t;
            if (!e && void 0 !== t.textures[this.uuid]) return t.textures[this.uuid];
            const n = {
                metadata: {
                    version: 4.7,
                    type: "Texture",
                    generator: "Texture.toJSON"
                },
                uuid: this.uuid,
                name: this.name,
                image: this.source.toJSON(t).uuid,
                mapping: this.mapping,
                channel: this.channel,
                repeat: [this.repeat.x, this.repeat.y],
                offset: [this.offset.x, this.offset.y],
                center: [this.center.x, this.center.y],
                rotation: this.rotation,
                wrap: [this.wrapS, this.wrapT],
                format: this.format,
                internalFormat: this.internalFormat,
                type: this.type,
                colorSpace: this.colorSpace,
                minFilter: this.minFilter,
                magFilter: this.magFilter,
                anisotropy: this.anisotropy,
                flipY: this.flipY,
                generateMipmaps: this.generateMipmaps,
                premultiplyAlpha: this.premultiplyAlpha,
                unpackAlignment: this.unpackAlignment
            };
            return Object.keys(this.userData).length > 0 && (n.userData = this.userData), e || (t.textures[this.uuid] = n), n
        }
        dispose() {
            this.dispatchEvent({
                type: "dispose"
            })
        }
        transformUv(t) {
            if (300 !== this.mapping) return t;
            if (t.applyMatrix3(this.matrix), t.x < 0 || t.x > 1) switch (this.wrapS) {
                case l:
                    t.x = t.x - Math.floor(t.x);
                    break;
                case c:
                    t.x = t.x < 0 ? 0 : 1;
                    break;
                case h:
                    1 === Math.abs(Math.floor(t.x) % 2) ? t.x = Math.ceil(t.x) - t.x : t.x = t.x - Math.floor(t.x)
            }
            if (t.y < 0 || t.y > 1) switch (this.wrapT) {
                case l:
                    t.y = t.y - Math.floor(t.y);
                    break;
                case c:
                    t.y = t.y < 0 ? 0 : 1;
                    break;
                case h:
                    1 === Math.abs(Math.floor(t.y) % 2) ? t.y = Math.ceil(t.y) - t.y : t.y = t.y - Math.floor(t.y)
            }
            return this.flipY && (t.y = 1 - t.y), t
        }
        set needsUpdate(t) {
            !0 === t && (this.version++, this.source.needsUpdate = !0)
        }
        set needsPMREMUpdate(t) {
            !0 === t && this.pmremVersion++
        }
    };
St.DEFAULT_IMAGE = null, St.DEFAULT_MAPPING = 300, St.DEFAULT_ANISOTROPY = 1;
var Et = class t {
        constructor(e = 0, n = 0, i = 0, a = 1) {
            t.prototype.isVector4 = !0, this.x = e, this.y = n, this.z = i, this.w = a
        }
        get width() {
            return this.z
        }
        set width(t) {
            this.z = t
        }
        get height() {
            return this.w
        }
        set height(t) {
            this.w = t
        }
        set(t, e, n, i) {
            return this.x = t, this.y = e, this.z = n, this.w = i, this
        }
        setScalar(t) {
            return this.x = t, this.y = t, this.z = t, this.w = t, this
        }
        setX(t) {
            return this.x = t, this
        }
        setY(t) {
            return this.y = t, this
        }
        setZ(t) {
            return this.z = t, this
        }
        setW(t) {
            return this.w = t, this
        }
        setComponent(t, e) {
            switch (t) {
                case 0:
                    this.x = e;
                    break;
                case 1:
                    this.y = e;
                    break;
                case 2:
                    this.z = e;
                    break;
                case 3:
                    this.w = e;
                    break;
                default:
                    throw new Error("index is out of range: " + t)
            }
            return this
        }
        getComponent(t) {
            switch (t) {
                case 0:
                    return this.x;
                case 1:
                    return this.y;
                case 2:
                    return this.z;
                case 3:
                    return this.w;
                default:
                    throw new Error("index is out of range: " + t)
            }
        }
        clone() {
            return new this.constructor(this.x, this.y, this.z, this.w)
        }
        copy(t) {
            return this.x = t.x, this.y = t.y, this.z = t.z, this.w = void 0 !== t.w ? t.w : 1, this
        }
        add(t) {
            return this.x += t.x, this.y += t.y, this.z += t.z, this.w += t.w, this
        }
        addScalar(t) {
            return this.x += t, this.y += t, this.z += t, this.w += t, this
        }
        addVectors(t, e) {
            return this.x = t.x + e.x, this.y = t.y + e.y, this.z = t.z + e.z, this.w = t.w + e.w, this
        }
        addScaledVector(t, e) {
            return this.x += t.x * e, this.y += t.y * e, this.z += t.z * e, this.w += t.w * e, this
        }
        sub(t) {
            return this.x -= t.x, this.y -= t.y, this.z -= t.z, this.w -= t.w, this
        }
        subScalar(t) {
            return this.x -= t, this.y -= t, this.z -= t, this.w -= t, this
        }
        subVectors(t, e) {
            return this.x = t.x - e.x, this.y = t.y - e.y, this.z = t.z - e.z, this.w = t.w - e.w, this
        }
        multiply(t) {
            return this.x *= t.x, this.y *= t.y, this.z *= t.z, this.w *= t.w, this
        }
        multiplyScalar(t) {
            return this.x *= t, this.y *= t, this.z *= t, this.w *= t, this
        }
        applyMatrix4(t) {
            const e = this.x,
                n = this.y,
                i = this.z,
                a = this.w,
                r = t.elements;
            return this.x = r[0] * e + r[4] * n + r[8] * i + r[12] * a, this.y = r[1] * e + r[5] * n + r[9] * i + r[13] * a, this.z = r[2] * e + r[6] * n + r[10] * i + r[14] * a, this.w = r[3] * e + r[7] * n + r[11] * i + r[15] * a, this
        }
        divide(t) {
            return this.x /= t.x, this.y /= t.y, this.z /= t.z, this.w /= t.w, this
        }
        divideScalar(t) {
            return this.multiplyScalar(1 / t)
        }
        setAxisAngleFromQuaternion(t) {
            this.w = 2 * Math.acos(t.w);
            const e = Math.sqrt(1 - t.w * t.w);
            return e < 1e-4 ? (this.x = 1, this.y = 0, this.z = 0) : (this.x = t.x / e, this.y = t.y / e, this.z = t.z / e), this
        }
        setAxisAngleFromRotationMatrix(t) {
            let e, n, i, a;
            const r = .01,
                s = .1,
                o = t.elements,
                l = o[0],
                c = o[4],
                h = o[8],
                u = o[1],
                d = o[5],
                p = o[9],
                m = o[2],
                f = o[6],
                g = o[10];
            if (Math.abs(c - u) < r && Math.abs(h - m) < r && Math.abs(p - f) < r) {
                if (Math.abs(c + u) < s && Math.abs(h + m) < s && Math.abs(p + f) < s && Math.abs(l + d + g - 3) < s) return this.set(1, 0, 0, 0), this;
                e = Math.PI;
                const t = (l + 1) / 2,
                    o = (d + 1) / 2,
                    _ = (g + 1) / 2,
                    v = (c + u) / 4,
                    x = (h + m) / 4,
                    M = (p + f) / 4;
                return t > o && t > _ ? t < r ? (n = 0, i = .707106781, a = .707106781) : (n = Math.sqrt(t), i = v / n, a = x / n) : o > _ ? o < r ? (n = .707106781, i = 0, a = .707106781) : (i = Math.sqrt(o), n = v / i, a = M / i) : _ < r ? (n = .707106781, i = .707106781, a = 0) : (a = Math.sqrt(_), n = x / a, i = M / a), this.set(n, i, a, e), this
            }
            let _ = Math.sqrt((f - p) * (f - p) + (h - m) * (h - m) + (u - c) * (u - c));
            return Math.abs(_) < .001 && (_ = 1), this.x = (f - p) / _, this.y = (h - m) / _, this.z = (u - c) / _, this.w = Math.acos((l + d + g - 1) / 2), this
        }
        setFromMatrixPosition(t) {
            const e = t.elements;
            return this.x = e[12], this.y = e[13], this.z = e[14], this.w = e[15], this
        }
        min(t) {
            return this.x = Math.min(this.x, t.x), this.y = Math.min(this.y, t.y), this.z = Math.min(this.z, t.z), this.w = Math.min(this.w, t.w), this
        }
        max(t) {
            return this.x = Math.max(this.x, t.x), this.y = Math.max(this.y, t.y), this.z = Math.max(this.z, t.z), this.w = Math.max(this.w, t.w), this
        }
        clamp(t, e) {
            return this.x = J(this.x, t.x, e.x), this.y = J(this.y, t.y, e.y), this.z = J(this.z, t.z, e.z), this.w = J(this.w, t.w, e.w), this
        }
        clampScalar(t, e) {
            return this.x = J(this.x, t, e), this.y = J(this.y, t, e), this.z = J(this.z, t, e), this.w = J(this.w, t, e), this
        }
        clampLength(t, e) {
            const n = this.length();
            return this.divideScalar(n || 1).multiplyScalar(J(n, t, e))
        }
        floor() {
            return this.x = Math.floor(this.x), this.y = Math.floor(this.y), this.z = Math.floor(this.z), this.w = Math.floor(this.w), this
        }
        ceil() {
            return this.x = Math.ceil(this.x), this.y = Math.ceil(this.y), this.z = Math.ceil(this.z), this.w = Math.ceil(this.w), this
        }
        round() {
            return this.x = Math.round(this.x), this.y = Math.round(this.y), this.z = Math.round(this.z), this.w = Math.round(this.w), this
        }
        roundToZero() {
            return this.x = Math.trunc(this.x), this.y = Math.trunc(this.y), this.z = Math.trunc(this.z), this.w = Math.trunc(this.w), this
        }
        negate() {
            return this.x = -this.x, this.y = -this.y, this.z = -this.z, this.w = -this.w, this
        }
        dot(t) {
            return this.x * t.x + this.y * t.y + this.z * t.z + this.w * t.w
        }
        lengthSq() {
            return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w
        }
        length() {
            return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w)
        }
        manhattanLength() {
            return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w)
        }
        normalize() {
            return this.divideScalar(this.length() || 1)
        }
        setLength(t) {
            return this.normalize().multiplyScalar(t)
        }
        lerp(t, e) {
            return this.x += (t.x - this.x) * e, this.y += (t.y - this.y) * e, this.z += (t.z - this.z) * e, this.w += (t.w - this.w) * e, this
        }
        lerpVectors(t, e, n) {
            return this.x = t.x + (e.x - t.x) * n, this.y = t.y + (e.y - t.y) * n, this.z = t.z + (e.z - t.z) * n, this.w = t.w + (e.w - t.w) * n, this
        }
        equals(t) {
            return t.x === this.x && t.y === this.y && t.z === this.z && t.w === this.w
        }
        fromArray(t, e = 0) {
            return this.x = t[e], this.y = t[e + 1], this.z = t[e + 2], this.w = t[e + 3], this
        }
        toArray(t = [], e = 0) {
            return t[e] = this.x, t[e + 1] = this.y, t[e + 2] = this.z, t[e + 3] = this.w, t
        }
        fromBufferAttribute(t, e) {
            return this.x = t.getX(e), this.y = t.getY(e), this.z = t.getZ(e), this.w = t.getW(e), this
        }
        random() {
            return this.x = Math.random(), this.y = Math.random(), this.z = Math.random(), this.w = Math.random(), this
        }*[Symbol.iterator]() {
            yield this.x, yield this.y, yield this.z, yield this.w
        }
    },
    Tt = class extends X {
        constructor(t = 1, e = 1, n = {}) {
            super(), n = Object.assign({
                generateMipmaps: !1,
                internalFormat: null,
                minFilter: m,
                depthBuffer: !0,
                stencilBuffer: !1,
                resolveDepthBuffer: !0,
                resolveStencilBuffer: !0,
                depthTexture: null,
                samples: 0,
                count: 1,
                depth: 1,
                multiview: !1
            }, n), this.isRenderTarget = !0, this.width = t, this.height = e, this.depth = n.depth, this.scissor = new Et(0, 0, t, e), this.scissorTest = !1, this.viewport = new Et(0, 0, t, e), this.textures = [];
            const i = new St({
                    width: t,
                    height: e,
                    depth: n.depth
                }),
                a = n.count;
            for (let r = 0; r < a; r++) this.textures[r] = i.clone(), this.textures[r].isRenderTargetTexture = !0, this.textures[r].renderTarget = this;
            this._setTextureOptions(n), this.depthBuffer = n.depthBuffer, this.stencilBuffer = n.stencilBuffer, this.resolveDepthBuffer = n.resolveDepthBuffer, this.resolveStencilBuffer = n.resolveStencilBuffer, this._depthTexture = null, this.depthTexture = n.depthTexture, this.samples = n.samples, this.multiview = n.multiview
        }
        _setTextureOptions(t = {}) {
            const e = {
                minFilter: m,
                generateMipmaps: !1,
                flipY: !1,
                internalFormat: null
            };
            void 0 !== t.mapping && (e.mapping = t.mapping), void 0 !== t.wrapS && (e.wrapS = t.wrapS), void 0 !== t.wrapT && (e.wrapT = t.wrapT), void 0 !== t.wrapR && (e.wrapR = t.wrapR), void 0 !== t.magFilter && (e.magFilter = t.magFilter), void 0 !== t.minFilter && (e.minFilter = t.minFilter), void 0 !== t.format && (e.format = t.format), void 0 !== t.type && (e.type = t.type), void 0 !== t.anisotropy && (e.anisotropy = t.anisotropy), void 0 !== t.colorSpace && (e.colorSpace = t.colorSpace), void 0 !== t.flipY && (e.flipY = t.flipY), void 0 !== t.generateMipmaps && (e.generateMipmaps = t.generateMipmaps), void 0 !== t.internalFormat && (e.internalFormat = t.internalFormat);
            for (let n = 0; n < this.textures.length; n++) this.textures[n].setValues(e)
        }
        get texture() {
            return this.textures[0]
        }
        set texture(t) {
            this.textures[0] = t
        }
        set depthTexture(t) {
            null !== this._depthTexture && (this._depthTexture.renderTarget = null), null !== t && (t.renderTarget = this), this._depthTexture = t
        }
        get depthTexture() {
            return this._depthTexture
        }
        setSize(t, e, n = 1) {
            if (this.width !== t || this.height !== e || this.depth !== n) {
                this.width = t, this.height = e, this.depth = n;
                for (let i = 0, a = this.textures.length; i < a; i++) this.textures[i].image.width = t, this.textures[i].image.height = e, this.textures[i].image.depth = n, !0 !== this.textures[i].isData3DTexture && (this.textures[i].isArrayTexture = this.textures[i].image.depth > 1);
                this.dispose()
            }
            this.viewport.set(0, 0, t, e), this.scissor.set(0, 0, t, e)
        }
        clone() {
            return (new this.constructor).copy(this)
        }
        copy(t) {
            this.width = t.width, this.height = t.height, this.depth = t.depth, this.scissor.copy(t.scissor), this.scissorTest = t.scissorTest, this.viewport.copy(t.viewport), this.textures.length = 0;
            for (let e = 0, n = t.textures.length; e < n; e++) {
                this.textures[e] = t.textures[e].clone(), this.textures[e].isRenderTargetTexture = !0, this.textures[e].renderTarget = this;
                const n = Object.assign({}, t.textures[e].image);
                this.textures[e].source = new xt(n)
            }
            return this.depthBuffer = t.depthBuffer, this.stencilBuffer = t.stencilBuffer, this.resolveDepthBuffer = t.resolveDepthBuffer, this.resolveStencilBuffer = t.resolveStencilBuffer, null !== t.depthTexture && (this.depthTexture = t.depthTexture.clone()), this.samples = t.samples, this
        }
        dispose() {
            this.dispatchEvent({
                type: "dispose"
            })
        }
    },
    wt = class extends Tt {
        constructor(t = 1, e = 1, n = {}) {
            super(t, e, n), this.isWebGLRenderTarget = !0
        }
    },
    At = class extends St {
        constructor(t = null, e = 1, n = 1, i = 1) {
            super(null), this.isDataArrayTexture = !0, this.image = {
                data: t,
                width: e,
                height: n,
                depth: i
            }, this.magFilter = u, this.minFilter = u, this.wrapR = c, this.generateMipmaps = !1, this.flipY = !1, this.unpackAlignment = 1, this.layerUpdates = new Set
        }
        addLayerUpdate(t) {
            this.layerUpdates.add(t)
        }
        clearLayerUpdates() {
            this.layerUpdates.clear()
        }
    },
    Rt = class extends St {
        constructor(t = null, e = 1, n = 1, i = 1) {
            super(null), this.isData3DTexture = !0, this.image = {
                data: t,
                width: e,
                height: n,
                depth: i
            }, this.magFilter = u, this.minFilter = u, this.wrapR = c, this.generateMipmaps = !1, this.flipY = !1, this.unpackAlignment = 1
        }
    },
    Ct = class t {
        constructor(e, n, i, a, r, s, o, l, c, h, u, d, p, m, f, g) {
            t.prototype.isMatrix4 = !0, this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], void 0 !== e && this.set(e, n, i, a, r, s, o, l, c, h, u, d, p, m, f, g)
        }
        set(t, e, n, i, a, r, s, o, l, c, h, u, d, p, m, f) {
            const g = this.elements;
            return g[0] = t, g[4] = e, g[8] = n, g[12] = i, g[1] = a, g[5] = r, g[9] = s, g[13] = o, g[2] = l, g[6] = c, g[10] = h, g[14] = u, g[3] = d, g[7] = p, g[11] = m, g[15] = f, this
        }
        identity() {
            return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), this
        }
        clone() {
            return (new t).fromArray(this.elements)
        }
        copy(t) {
            const e = this.elements,
                n = t.elements;
            return e[0] = n[0], e[1] = n[1], e[2] = n[2], e[3] = n[3], e[4] = n[4], e[5] = n[5], e[6] = n[6], e[7] = n[7], e[8] = n[8], e[9] = n[9], e[10] = n[10], e[11] = n[11], e[12] = n[12], e[13] = n[13], e[14] = n[14], e[15] = n[15], this
        }
        copyPosition(t) {
            const e = this.elements,
                n = t.elements;
            return e[12] = n[12], e[13] = n[13], e[14] = n[14], this
        }
        setFromMatrix3(t) {
            const e = t.elements;
            return this.set(e[0], e[3], e[6], 0, e[1], e[4], e[7], 0, e[2], e[5], e[8], 0, 0, 0, 0, 1), this
        }
        extractBasis(t, e, n) {
            return 0 === this.determinant() ? (t.set(1, 0, 0), e.set(0, 1, 0), n.set(0, 0, 1), this) : (t.setFromMatrixColumn(this, 0), e.setFromMatrixColumn(this, 1), n.setFromMatrixColumn(this, 2), this)
        }
        makeBasis(t, e, n) {
            return this.set(t.x, e.x, n.x, 0, t.y, e.y, n.y, 0, t.z, e.z, n.z, 0, 0, 0, 0, 1), this
        }
        extractRotation(t) {
            if (0 === t.determinant()) return this.identity();
            const e = this.elements,
                n = t.elements,
                i = 1 / Pt.setFromMatrixColumn(t, 0).length(),
                a = 1 / Pt.setFromMatrixColumn(t, 1).length(),
                r = 1 / Pt.setFromMatrixColumn(t, 2).length();
            return e[0] = n[0] * i, e[1] = n[1] * i, e[2] = n[2] * i, e[3] = 0, e[4] = n[4] * a, e[5] = n[5] * a, e[6] = n[6] * a, e[7] = 0, e[8] = n[8] * r, e[9] = n[9] * r, e[10] = n[10] * r, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, this
        }
        makeRotationFromEuler(t) {
            const e = this.elements,
                n = t.x,
                i = t.y,
                a = t.z,
                r = Math.cos(n),
                s = Math.sin(n),
                o = Math.cos(i),
                l = Math.sin(i),
                c = Math.cos(a),
                h = Math.sin(a);
            if ("XYZ" === t.order) {
                const t = r * c,
                    n = r * h,
                    i = s * c,
                    a = s * h;
                e[0] = o * c, e[4] = -o * h, e[8] = l, e[1] = n + i * l, e[5] = t - a * l, e[9] = -s * o, e[2] = a - t * l, e[6] = i + n * l, e[10] = r * o
            } else if ("YXZ" === t.order) {
                const t = o * c,
                    n = o * h,
                    i = l * c,
                    a = l * h;
                e[0] = t + a * s, e[4] = i * s - n, e[8] = r * l, e[1] = r * h, e[5] = r * c, e[9] = -s, e[2] = n * s - i, e[6] = a + t * s, e[10] = r * o
            } else if ("ZXY" === t.order) {
                const t = o * c,
                    n = o * h,
                    i = l * c,
                    a = l * h;
                e[0] = t - a * s, e[4] = -r * h, e[8] = i + n * s, e[1] = n + i * s, e[5] = r * c, e[9] = a - t * s, e[2] = -r * l, e[6] = s, e[10] = r * o
            } else if ("ZYX" === t.order) {
                const t = r * c,
                    n = r * h,
                    i = s * c,
                    a = s * h;
                e[0] = o * c, e[4] = i * l - n, e[8] = t * l + a, e[1] = o * h, e[5] = a * l + t, e[9] = n * l - i, e[2] = -l, e[6] = s * o, e[10] = r * o
            } else if ("YZX" === t.order) {
                const t = r * o,
                    n = r * l,
                    i = s * o,
                    a = s * l;
                e[0] = o * c, e[4] = a - t * h, e[8] = i * h + n, e[1] = h, e[5] = r * c, e[9] = -s * c, e[2] = -l * c, e[6] = n * h + i, e[10] = t - a * h
            } else if ("XZY" === t.order) {
                const t = r * o,
                    n = r * l,
                    i = s * o,
                    a = s * l;
                e[0] = o * c, e[4] = -h, e[8] = l * c, e[1] = t * h + a, e[5] = r * c, e[9] = n * h - i, e[2] = i * h - n, e[6] = s * c, e[10] = a * h + t
            }
            return e[3] = 0, e[7] = 0, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, this
        }
        makeRotationFromQuaternion(t) {
            return this.compose(Lt, t, It)
        }
        lookAt(t, e, n) {
            const i = this.elements;
            return Ot.subVectors(t, e), 0 === Ot.lengthSq() && (Ot.z = 1), Ot.normalize(), Ut.crossVectors(n, Ot), 0 === Ut.lengthSq() && (1 === Math.abs(n.z) ? Ot.x += 1e-4 : Ot.z += 1e-4, Ot.normalize(), Ut.crossVectors(n, Ot)), Ut.normalize(), Nt.crossVectors(Ot, Ut), i[0] = Ut.x, i[4] = Nt.x, i[8] = Ot.x, i[1] = Ut.y, i[5] = Nt.y, i[9] = Ot.y, i[2] = Ut.z, i[6] = Nt.z, i[10] = Ot.z, this
        }
        multiply(t) {
            return this.multiplyMatrices(this, t)
        }
        premultiply(t) {
            return this.multiplyMatrices(t, this)
        }
        multiplyMatrices(t, e) {
            const n = t.elements,
                i = e.elements,
                a = this.elements,
                r = n[0],
                s = n[4],
                o = n[8],
                l = n[12],
                c = n[1],
                h = n[5],
                u = n[9],
                d = n[13],
                p = n[2],
                m = n[6],
                f = n[10],
                g = n[14],
                _ = n[3],
                v = n[7],
                x = n[11],
                M = n[15],
                b = i[0],
                y = i[4],
                S = i[8],
                E = i[12],
                T = i[1],
                w = i[5],
                A = i[9],
                R = i[13],
                C = i[2],
                P = i[6],
                D = i[10],
                L = i[14],
                I = i[3],
                U = i[7],
                N = i[11],
                O = i[15];
            return a[0] = r * b + s * T + o * C + l * I, a[4] = r * y + s * w + o * P + l * U, a[8] = r * S + s * A + o * D + l * N, a[12] = r * E + s * R + o * L + l * O, a[1] = c * b + h * T + u * C + d * I, a[5] = c * y + h * w + u * P + d * U, a[9] = c * S + h * A + u * D + d * N, a[13] = c * E + h * R + u * L + d * O, a[2] = p * b + m * T + f * C + g * I, a[6] = p * y + m * w + f * P + g * U, a[10] = p * S + m * A + f * D + g * N, a[14] = p * E + m * R + f * L + g * O, a[3] = _ * b + v * T + x * C + M * I, a[7] = _ * y + v * w + x * P + M * U, a[11] = _ * S + v * A + x * D + M * N, a[15] = _ * E + v * R + x * L + M * O, this
        }
        multiplyScalar(t) {
            const e = this.elements;
            return e[0] *= t, e[4] *= t, e[8] *= t, e[12] *= t, e[1] *= t, e[5] *= t, e[9] *= t, e[13] *= t, e[2] *= t, e[6] *= t, e[10] *= t, e[14] *= t, e[3] *= t, e[7] *= t, e[11] *= t, e[15] *= t, this
        }
        determinant() {
            const t = this.elements,
                e = t[0],
                n = t[4],
                i = t[8],
                a = t[12],
                r = t[1],
                s = t[5],
                o = t[9],
                l = t[13],
                c = t[2],
                h = t[6],
                u = t[10],
                d = t[14],
                p = t[3],
                m = t[7],
                f = t[11],
                g = t[15],
                _ = o * d - l * u,
                v = s * d - l * h,
                x = s * u - o * h,
                M = r * d - l * c,
                b = r * u - o * c,
                y = r * h - s * c;
            return e * (m * _ - f * v + g * x) - n * (p * _ - f * M + g * b) + i * (p * v - m * M + g * y) - a * (p * x - m * b + f * y)
        }
        transpose() {
            const t = this.elements;
            let e;
            return e = t[1], t[1] = t[4], t[4] = e, e = t[2], t[2] = t[8], t[8] = e, e = t[6], t[6] = t[9], t[9] = e, e = t[3], t[3] = t[12], t[12] = e, e = t[7], t[7] = t[13], t[13] = e, e = t[11], t[11] = t[14], t[14] = e, this
        }
        setPosition(t, e, n) {
            const i = this.elements;
            return t.isVector3 ? (i[12] = t.x, i[13] = t.y, i[14] = t.z) : (i[12] = t, i[13] = e, i[14] = n), this
        }
        invert() {
            const t = this.elements,
                e = t[0],
                n = t[1],
                i = t[2],
                a = t[3],
                r = t[4],
                s = t[5],
                o = t[6],
                l = t[7],
                c = t[8],
                h = t[9],
                u = t[10],
                d = t[11],
                p = t[12],
                m = t[13],
                f = t[14],
                g = t[15],
                _ = e * s - n * r,
                v = e * o - i * r,
                x = e * l - a * r,
                M = n * o - i * s,
                b = n * l - a * s,
                y = i * l - a * o,
                S = c * m - h * p,
                E = c * f - u * p,
                T = c * g - d * p,
                w = h * f - u * m,
                A = h * g - d * m,
                R = u * g - d * f,
                C = _ * R - v * A + x * w + M * T - b * E + y * S;
            if (0 === C) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
            const P = 1 / C;
            return t[0] = (s * R - o * A + l * w) * P, t[1] = (i * A - n * R - a * w) * P, t[2] = (m * y - f * b + g * M) * P, t[3] = (u * b - h * y - d * M) * P, t[4] = (o * T - r * R - l * E) * P, t[5] = (e * R - i * T + a * E) * P, t[6] = (f * x - p * y - g * v) * P, t[7] = (c * y - u * x + d * v) * P, t[8] = (r * A - s * T + l * S) * P, t[9] = (n * T - e * A - a * S) * P, t[10] = (p * b - m * x + g * _) * P, t[11] = (h * x - c * b - d * _) * P, t[12] = (s * E - r * w - o * S) * P, t[13] = (e * w - n * E + i * S) * P, t[14] = (m * v - p * M - f * _) * P, t[15] = (c * M - h * v + u * _) * P, this
        }
        scale(t) {
            const e = this.elements,
                n = t.x,
                i = t.y,
                a = t.z;
            return e[0] *= n, e[4] *= i, e[8] *= a, e[1] *= n, e[5] *= i, e[9] *= a, e[2] *= n, e[6] *= i, e[10] *= a, e[3] *= n, e[7] *= i, e[11] *= a, this
        }
        getMaxScaleOnAxis() {
            const t = this.elements,
                e = t[0] * t[0] + t[1] * t[1] + t[2] * t[2],
                n = t[4] * t[4] + t[5] * t[5] + t[6] * t[6],
                i = t[8] * t[8] + t[9] * t[9] + t[10] * t[10];
            return Math.sqrt(Math.max(e, n, i))
        }
        makeTranslation(t, e, n) {
            return t.isVector3 ? this.set(1, 0, 0, t.x, 0, 1, 0, t.y, 0, 0, 1, t.z, 0, 0, 0, 1) : this.set(1, 0, 0, t, 0, 1, 0, e, 0, 0, 1, n, 0, 0, 0, 1), this
        }
        makeRotationX(t) {
            const e = Math.cos(t),
                n = Math.sin(t);
            return this.set(1, 0, 0, 0, 0, e, -n, 0, 0, n, e, 0, 0, 0, 0, 1), this
        }
        makeRotationY(t) {
            const e = Math.cos(t),
                n = Math.sin(t);
            return this.set(e, 0, n, 0, 0, 1, 0, 0, -n, 0, e, 0, 0, 0, 0, 1), this
        }
        makeRotationZ(t) {
            const e = Math.cos(t),
                n = Math.sin(t);
            return this.set(e, -n, 0, 0, n, e, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), this
        }
        makeRotationAxis(t, e) {
            const n = Math.cos(e),
                i = Math.sin(e),
                a = 1 - n,
                r = t.x,
                s = t.y,
                o = t.z,
                l = a * r,
                c = a * s;
            return this.set(l * r + n, l * s - i * o, l * o + i * s, 0, l * s + i * o, c * s + n, c * o - i * r, 0, l * o - i * s, c * o + i * r, a * o * o + n, 0, 0, 0, 0, 1), this
        }
        makeScale(t, e, n) {
            return this.set(t, 0, 0, 0, 0, e, 0, 0, 0, 0, n, 0, 0, 0, 0, 1), this
        }
        makeShear(t, e, n, i, a, r) {
            return this.set(1, n, a, 0, t, 1, r, 0, e, i, 1, 0, 0, 0, 0, 1), this
        }
        compose(t, e, n) {
            const i = this.elements,
                a = e._x,
                r = e._y,
                s = e._z,
                o = e._w,
                l = a + a,
                c = r + r,
                h = s + s,
                u = a * l,
                d = a * c,
                p = a * h,
                m = r * c,
                f = r * h,
                g = s * h,
                _ = o * l,
                v = o * c,
                x = o * h,
                M = n.x,
                b = n.y,
                y = n.z;
            return i[0] = (1 - (m + g)) * M, i[1] = (d + x) * M, i[2] = (p - v) * M, i[3] = 0, i[4] = (d - x) * b, i[5] = (1 - (u + g)) * b, i[6] = (f + _) * b, i[7] = 0, i[8] = (p + v) * y, i[9] = (f - _) * y, i[10] = (1 - (u + m)) * y, i[11] = 0, i[12] = t.x, i[13] = t.y, i[14] = t.z, i[15] = 1, this
        }
        decompose(t, e, n) {
            const i = this.elements;
            t.x = i[12], t.y = i[13], t.z = i[14];
            const a = this.determinant();
            if (0 === a) return n.set(1, 1, 1), e.identity(), this;
            let r = Pt.set(i[0], i[1], i[2]).length();
            const s = Pt.set(i[4], i[5], i[6]).length(),
                o = Pt.set(i[8], i[9], i[10]).length();
            a < 0 && (r = -r), Dt.copy(this);
            const l = 1 / r,
                c = 1 / s,
                h = 1 / o;
            return Dt.elements[0] *= l, Dt.elements[1] *= l, Dt.elements[2] *= l, Dt.elements[4] *= c, Dt.elements[5] *= c, Dt.elements[6] *= c, Dt.elements[8] *= h, Dt.elements[9] *= h, Dt.elements[10] *= h, e.setFromRotationMatrix(Dt), n.x = r, n.y = s, n.z = o, this
        }
        makePerspective(t, e, n, i, a, r, s = 2e3, o = !1) {
            const l = this.elements,
                c = 2 * a / (e - t),
                h = 2 * a / (n - i),
                u = (e + t) / (e - t),
                d = (n + i) / (n - i);
            let p, m;
            if (o) p = a / (r - a), m = r * a / (r - a);
            else if (2e3 === s) p = -(r + a) / (r - a), m = -2 * r * a / (r - a);
            else {
                if (2001 !== s) throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: " + s);
                p = -r / (r - a), m = -r * a / (r - a)
            }
            return l[0] = c, l[4] = 0, l[8] = u, l[12] = 0, l[1] = 0, l[5] = h, l[9] = d, l[13] = 0, l[2] = 0, l[6] = 0, l[10] = p, l[14] = m, l[3] = 0, l[7] = 0, l[11] = -1, l[15] = 0, this
        }
        makeOrthographic(t, e, n, i, a, r, s = 2e3, o = !1) {
            const l = this.elements,
                c = 2 / (e - t),
                h = 2 / (n - i),
                u = -(e + t) / (e - t),
                d = -(n + i) / (n - i);
            let p, m;
            if (o) p = 1 / (r - a), m = r / (r - a);
            else if (2e3 === s) p = -2 / (r - a), m = -(r + a) / (r - a);
            else {
                if (2001 !== s) throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: " + s);
                p = -1 / (r - a), m = -a / (r - a)
            }
            return l[0] = c, l[4] = 0, l[8] = 0, l[12] = u, l[1] = 0, l[5] = h, l[9] = 0, l[13] = d, l[2] = 0, l[6] = 0, l[10] = p, l[14] = m, l[3] = 0, l[7] = 0, l[11] = 0, l[15] = 1, this
        }
        equals(t) {
            const e = this.elements,
                n = t.elements;
            for (let i = 0; i < 16; i++)
                if (e[i] !== n[i]) return !1;
            return !0
        }
        fromArray(t, e = 0) {
            for (let n = 0; n < 16; n++) this.elements[n] = t[n + e];
            return this
        }
        toArray(t = [], e = 0) {
            const n = this.elements;
            return t[e] = n[0], t[e + 1] = n[1], t[e + 2] = n[2], t[e + 3] = n[3], t[e + 4] = n[4], t[e + 5] = n[5], t[e + 6] = n[6], t[e + 7] = n[7], t[e + 8] = n[8], t[e + 9] = n[9], t[e + 10] = n[10], t[e + 11] = n[11], t[e + 12] = n[12], t[e + 13] = n[13], t[e + 14] = n[14], t[e + 15] = n[15], t
        }
    },
    Pt = new rt,
    Dt = new Ct,
    Lt = new rt(0, 0, 0),
    It = new rt(1, 1, 1),
    Ut = new rt,
    Nt = new rt,
    Ot = new rt,
    Ft = new Ct,
    Bt = new at,
    zt = class t {
        constructor(e = 0, n = 0, i = 0, a = t.DEFAULT_ORDER) {
            this.isEuler = !0, this._x = e, this._y = n, this._z = i, this._order = a
        }
        get x() {
            return this._x
        }
        set x(t) {
            this._x = t, this._onChangeCallback()
        }
        get y() {
            return this._y
        }
        set y(t) {
            this._y = t, this._onChangeCallback()
        }
        get z() {
            return this._z
        }
        set z(t) {
            this._z = t, this._onChangeCallback()
        }
        get order() {
            return this._order
        }
        set order(t) {
            this._order = t, this._onChangeCallback()
        }
        set(t, e, n, i = this._order) {
            return this._x = t, this._y = e, this._z = n, this._order = i, this._onChangeCallback(), this
        }
        clone() {
            return new this.constructor(this._x, this._y, this._z, this._order)
        }
        copy(t) {
            return this._x = t._x, this._y = t._y, this._z = t._z, this._order = t._order, this._onChangeCallback(), this
        }
        setFromRotationMatrix(t, e = this._order, n = !0) {
            const i = t.elements,
                a = i[0],
                r = i[4],
                s = i[8],
                o = i[1],
                l = i[5],
                c = i[9],
                h = i[2],
                u = i[6],
                d = i[10];
            switch (e) {
                case "XYZ":
                    this._y = Math.asin(J(s, -1, 1)), Math.abs(s) < .9999999 ? (this._x = Math.atan2(-c, d), this._z = Math.atan2(-r, a)) : (this._x = Math.atan2(u, l), this._z = 0);
                    break;
                case "YXZ":
                    this._x = Math.asin(-J(c, -1, 1)), Math.abs(c) < .9999999 ? (this._y = Math.atan2(s, d), this._z = Math.atan2(o, l)) : (this._y = Math.atan2(-h, a), this._z = 0);
                    break;
                case "ZXY":
                    this._x = Math.asin(J(u, -1, 1)), Math.abs(u) < .9999999 ? (this._y = Math.atan2(-h, d), this._z = Math.atan2(-r, l)) : (this._y = 0, this._z = Math.atan2(o, a));
                    break;
                case "ZYX":
                    this._y = Math.asin(-J(h, -1, 1)), Math.abs(h) < .9999999 ? (this._x = Math.atan2(u, d), this._z = Math.atan2(o, a)) : (this._x = 0, this._z = Math.atan2(-r, l));
                    break;
                case "YZX":
                    this._z = Math.asin(J(o, -1, 1)), Math.abs(o) < .9999999 ? (this._x = Math.atan2(-c, l), this._y = Math.atan2(-h, a)) : (this._x = 0, this._y = Math.atan2(s, d));
                    break;
                case "XZY":
                    this._z = Math.asin(-J(r, -1, 1)), Math.abs(r) < .9999999 ? (this._x = Math.atan2(u, l), this._y = Math.atan2(s, a)) : (this._x = Math.atan2(-c, d), this._y = 0);
                    break;
                default:
                    k("Euler: .setFromRotationMatrix() encountered an unknown order: " + e)
            }
            return this._order = e, !0 === n && this._onChangeCallback(), this
        }
        setFromQuaternion(t, e, n) {
            return Ft.makeRotationFromQuaternion(t), this.setFromRotationMatrix(Ft, e, n)
        }
        setFromVector3(t, e = this._order) {
            return this.set(t.x, t.y, t.z, e)
        }
        reorder(t) {
            return Bt.setFromEuler(this), this.setFromQuaternion(Bt, t)
        }
        equals(t) {
            return t._x === this._x && t._y === this._y && t._z === this._z && t._order === this._order
        }
        fromArray(t) {
            return this._x = t[0], this._y = t[1], this._z = t[2], void 0 !== t[3] && (this._order = t[3]), this._onChangeCallback(), this
        }
        toArray(t = [], e = 0) {
            return t[e] = this._x, t[e + 1] = this._y, t[e + 2] = this._z, t[e + 3] = this._order, t
        }
        _onChange(t) {
            return this._onChangeCallback = t, this
        }
        _onChangeCallback() {}*[Symbol.iterator]() {
            yield this._x, yield this._y, yield this._z, yield this._order
        }
    };
zt.DEFAULT_ORDER = "XYZ";
var Vt = class {
        constructor() {
            this.mask = 1
        }
        set(t) {
            this.mask = 1 << t >>> 0
        }
        enable(t) {
            this.mask |= 1 << t
        }
        enableAll() {
            this.mask = -1
        }
        toggle(t) {
            this.mask ^= 1 << t
        }
        disable(t) {
            this.mask &= ~(1 << t)
        }
        disableAll() {
            this.mask = 0
        }
        test(t) {
            return 0 !== (this.mask & t.mask)
        }
        isEnabled(t) {
            return !!(this.mask & 1 << t)
        }
    },
    kt = 0,
    Ht = new rt,
    Gt = new at,
    Wt = new Ct,
    Xt = new rt,
    Yt = new rt,
    jt = new rt,
    qt = new at,
    Zt = new rt(1, 0, 0),
    Kt = new rt(0, 1, 0),
    Jt = new rt(0, 0, 1),
    $t = {
        type: "added"
    },
    Qt = {
        type: "removed"
    },
    te = {
        type: "childadded",
        child: null
    },
    ee = {
        type: "childremoved",
        child: null
    },
    ne = class t extends X {
        constructor() {
            super(), this.isObject3D = !0, Object.defineProperty(this, "id", {
                value: kt++
            }), this.uuid = K(), this.name = "", this.type = "Object3D", this.parent = null, this.children = [], this.up = t.DEFAULT_UP.clone();
            const e = new rt,
                n = new zt,
                i = new at,
                a = new rt(1, 1, 1);
            n._onChange(function() {
                i.setFromEuler(n, !1)
            }), i._onChange(function() {
                n.setFromQuaternion(i, void 0, !1)
            }), Object.defineProperties(this, {
                position: {
                    configurable: !0,
                    enumerable: !0,
                    value: e
                },
                rotation: {
                    configurable: !0,
                    enumerable: !0,
                    value: n
                },
                quaternion: {
                    configurable: !0,
                    enumerable: !0,
                    value: i
                },
                scale: {
                    configurable: !0,
                    enumerable: !0,
                    value: a
                },
                modelViewMatrix: {
                    value: new Ct
                },
                normalMatrix: {
                    value: new lt
                }
            }), this.matrix = new Ct, this.matrixWorld = new Ct, this.matrixAutoUpdate = t.DEFAULT_MATRIX_AUTO_UPDATE, this.matrixWorldAutoUpdate = t.DEFAULT_MATRIX_WORLD_AUTO_UPDATE, this.matrixWorldNeedsUpdate = !1, this.layers = new Vt, this.visible = !0, this.castShadow = !1, this.receiveShadow = !1, this.frustumCulled = !0, this.renderOrder = 0, this.animations = [], this.customDepthMaterial = void 0, this.customDistanceMaterial = void 0, this.static = !1, this.userData = {}, this.pivot = null
        }
        onBeforeShadow() {}
        onAfterShadow() {}
        onBeforeRender() {}
        onAfterRender() {}
        applyMatrix4(t) {
            this.matrixAutoUpdate && this.updateMatrix(), this.matrix.premultiply(t), this.matrix.decompose(this.position, this.quaternion, this.scale)
        }
        applyQuaternion(t) {
            return this.quaternion.premultiply(t), this
        }
        setRotationFromAxisAngle(t, e) {
            this.quaternion.setFromAxisAngle(t, e)
        }
        setRotationFromEuler(t) {
            this.quaternion.setFromEuler(t, !0)
        }
        setRotationFromMatrix(t) {
            this.quaternion.setFromRotationMatrix(t)
        }
        setRotationFromQuaternion(t) {
            this.quaternion.copy(t)
        }
        rotateOnAxis(t, e) {
            return Gt.setFromAxisAngle(t, e), this.quaternion.multiply(Gt), this
        }
        rotateOnWorldAxis(t, e) {
            return Gt.setFromAxisAngle(t, e), this.quaternion.premultiply(Gt), this
        }
        rotateX(t) {
            return this.rotateOnAxis(Zt, t)
        }
        rotateY(t) {
            return this.rotateOnAxis(Kt, t)
        }
        rotateZ(t) {
            return this.rotateOnAxis(Jt, t)
        }
        translateOnAxis(t, e) {
            return Ht.copy(t).applyQuaternion(this.quaternion), this.position.add(Ht.multiplyScalar(e)), this
        }
        translateX(t) {
            return this.translateOnAxis(Zt, t)
        }
        translateY(t) {
            return this.translateOnAxis(Kt, t)
        }
        translateZ(t) {
            return this.translateOnAxis(Jt, t)
        }
        localToWorld(t) {
            return this.updateWorldMatrix(!0, !1), t.applyMatrix4(this.matrixWorld)
        }
        worldToLocal(t) {
            return this.updateWorldMatrix(!0, !1), t.applyMatrix4(Wt.copy(this.matrixWorld).invert())
        }
        lookAt(t, e, n) {
            t.isVector3 ? Xt.copy(t) : Xt.set(t, e, n);
            const i = this.parent;
            this.updateWorldMatrix(!0, !1), Yt.setFromMatrixPosition(this.matrixWorld), this.isCamera || this.isLight ? Wt.lookAt(Yt, Xt, this.up) : Wt.lookAt(Xt, Yt, this.up), this.quaternion.setFromRotationMatrix(Wt), i && (Wt.extractRotation(i.matrixWorld), Gt.setFromRotationMatrix(Wt), this.quaternion.premultiply(Gt.invert()))
        }
        add(t) {
            if (arguments.length > 1) {
                for (let t = 0; t < arguments.length; t++) this.add(arguments[t]);
                return this
            }
            return t === this ? (H("Object3D.add: object can't be added as a child of itself.", t), this) : (t && t.isObject3D ? (t.removeFromParent(), t.parent = this, this.children.push(t), t.dispatchEvent($t), te.child = t, this.dispatchEvent(te), te.child = null) : H("Object3D.add: object not an instance of THREE.Object3D.", t), this)
        }
        remove(t) {
            if (arguments.length > 1) {
                for (let t = 0; t < arguments.length; t++) this.remove(arguments[t]);
                return this
            }
            const e = this.children.indexOf(t);
            return -1 !== e && (t.parent = null, this.children.splice(e, 1), t.dispatchEvent(Qt), ee.child = t, this.dispatchEvent(ee), ee.child = null), this
        }
        removeFromParent() {
            const t = this.parent;
            return null !== t && t.remove(this), this
        }
        clear() {
            return this.remove(...this.children)
        }
        attach(t) {
            return this.updateWorldMatrix(!0, !1), Wt.copy(this.matrixWorld).invert(), null !== t.parent && (t.parent.updateWorldMatrix(!0, !1), Wt.multiply(t.parent.matrixWorld)), t.applyMatrix4(Wt), t.removeFromParent(), t.parent = this, this.children.push(t), t.updateWorldMatrix(!1, !0), t.dispatchEvent($t), te.child = t, this.dispatchEvent(te), te.child = null, this
        }
        getObjectById(t) {
            return this.getObjectByProperty("id", t)
        }
        getObjectByName(t) {
            return this.getObjectByProperty("name", t)
        }
        getObjectByProperty(t, e) {
            if (this[t] === e) return this;
            for (let n = 0, i = this.children.length; n < i; n++) {
                const i = this.children[n].getObjectByProperty(t, e);
                if (void 0 !== i) return i
            }
        }
        getObjectsByProperty(t, e, n = []) {
            this[t] === e && n.push(this);
            const i = this.children;
            for (let a = 0, r = i.length; a < r; a++) i[a].getObjectsByProperty(t, e, n);
            return n
        }
        getWorldPosition(t) {
            return this.updateWorldMatrix(!0, !1), t.setFromMatrixPosition(this.matrixWorld)
        }
        getWorldQuaternion(t) {
            return this.updateWorldMatrix(!0, !1), this.matrixWorld.decompose(Yt, t, jt), t
        }
        getWorldScale(t) {
            return this.updateWorldMatrix(!0, !1), this.matrixWorld.decompose(Yt, qt, t), t
        }
        getWorldDirection(t) {
            this.updateWorldMatrix(!0, !1);
            const e = this.matrixWorld.elements;
            return t.set(e[8], e[9], e[10]).normalize()
        }
        raycast() {}
        traverse(t) {
            t(this);
            const e = this.children;
            for (let n = 0, i = e.length; n < i; n++) e[n].traverse(t)
        }
        traverseVisible(t) {
            if (!1 === this.visible) return;
            t(this);
            const e = this.children;
            for (let n = 0, i = e.length; n < i; n++) e[n].traverseVisible(t)
        }
        traverseAncestors(t) {
            const e = this.parent;
            null !== e && (t(e), e.traverseAncestors(t))
        }
        updateMatrix() {
            this.matrix.compose(this.position, this.quaternion, this.scale);
            const t = this.pivot;
            if (null !== t) {
                const e = t.x,
                    n = t.y,
                    i = t.z,
                    a = this.matrix.elements;
                a[12] += e - a[0] * e - a[4] * n - a[8] * i, a[13] += n - a[1] * e - a[5] * n - a[9] * i, a[14] += i - a[2] * e - a[6] * n - a[10] * i
            }
            this.matrixWorldNeedsUpdate = !0
        }
        updateMatrixWorld(t) {
            this.matrixAutoUpdate && this.updateMatrix(), (this.matrixWorldNeedsUpdate || t) && (!0 === this.matrixWorldAutoUpdate && (null === this.parent ? this.matrixWorld.copy(this.matrix) : this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)), this.matrixWorldNeedsUpdate = !1, t = !0);
            const e = this.children;
            for (let n = 0, i = e.length; n < i; n++) e[n].updateMatrixWorld(t)
        }
        updateWorldMatrix(t, e) {
            const n = this.parent;
            if (!0 === t && null !== n && n.updateWorldMatrix(!0, !1), this.matrixAutoUpdate && this.updateMatrix(), !0 === this.matrixWorldAutoUpdate && (null === this.parent ? this.matrixWorld.copy(this.matrix) : this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)), !0 === e) {
                const t = this.children;
                for (let e = 0, n = t.length; e < n; e++) t[e].updateWorldMatrix(!1, !0)
            }
        }
        toJSON(t) {
            const e = void 0 === t || "string" == typeof t,
                n = {};
            e && (t = {
                geometries: {},
                materials: {},
                textures: {},
                images: {},
                shapes: {},
                skeletons: {},
                animations: {},
                nodes: {}
            }, n.metadata = {
                version: 4.7,
                type: "Object",
                generator: "Object3D.toJSON"
            });
            const i = {};

            function a(e, n) {
                return void 0 === e[n.uuid] && (e[n.uuid] = n.toJSON(t)), n.uuid
            }
            if (i.uuid = this.uuid, i.type = this.type, "" !== this.name && (i.name = this.name), !0 === this.castShadow && (i.castShadow = !0), !0 === this.receiveShadow && (i.receiveShadow = !0), !1 === this.visible && (i.visible = !1), !1 === this.frustumCulled && (i.frustumCulled = !1), 0 !== this.renderOrder && (i.renderOrder = this.renderOrder), !1 !== this.static && (i.static = this.static), Object.keys(this.userData).length > 0 && (i.userData = this.userData), i.layers = this.layers.mask, i.matrix = this.matrix.toArray(), i.up = this.up.toArray(), null !== this.pivot && (i.pivot = this.pivot.toArray()), !1 === this.matrixAutoUpdate && (i.matrixAutoUpdate = !1), void 0 !== this.morphTargetDictionary && (i.morphTargetDictionary = Object.assign({}, this.morphTargetDictionary)), void 0 !== this.morphTargetInfluences && (i.morphTargetInfluences = this.morphTargetInfluences.slice()), this.isInstancedMesh && (i.type = "InstancedMesh", i.count = this.count, i.instanceMatrix = this.instanceMatrix.toJSON(), null !== this.instanceColor && (i.instanceColor = this.instanceColor.toJSON())), this.isBatchedMesh && (i.type = "BatchedMesh", i.perObjectFrustumCulled = this.perObjectFrustumCulled, i.sortObjects = this.sortObjects, i.drawRanges = this._drawRanges, i.reservedRanges = this._reservedRanges, i.geometryInfo = this._geometryInfo.map(t => ({
                    ...t,
                    boundingBox: t.boundingBox ? t.boundingBox.toJSON() : void 0,
                    boundingSphere: t.boundingSphere ? t.boundingSphere.toJSON() : void 0
                })), i.instanceInfo = this._instanceInfo.map(t => ({
                    ...t
                })), i.availableInstanceIds = this._availableInstanceIds.slice(), i.availableGeometryIds = this._availableGeometryIds.slice(), i.nextIndexStart = this._nextIndexStart, i.nextVertexStart = this._nextVertexStart, i.geometryCount = this._geometryCount, i.maxInstanceCount = this._maxInstanceCount, i.maxVertexCount = this._maxVertexCount, i.maxIndexCount = this._maxIndexCount, i.geometryInitialized = this._geometryInitialized, i.matricesTexture = this._matricesTexture.toJSON(t), i.indirectTexture = this._indirectTexture.toJSON(t), null !== this._colorsTexture && (i.colorsTexture = this._colorsTexture.toJSON(t)), null !== this.boundingSphere && (i.boundingSphere = this.boundingSphere.toJSON()), null !== this.boundingBox && (i.boundingBox = this.boundingBox.toJSON())), this.isScene) this.background && (this.background.isColor ? i.background = this.background.toJSON() : this.background.isTexture && (i.background = this.background.toJSON(t).uuid)), this.environment && this.environment.isTexture && !0 !== this.environment.isRenderTargetTexture && (i.environment = this.environment.toJSON(t).uuid);
            else if (this.isMesh || this.isLine || this.isPoints) {
                i.geometry = a(t.geometries, this.geometry);
                const e = this.geometry.parameters;
                if (void 0 !== e && void 0 !== e.shapes) {
                    const n = e.shapes;
                    if (Array.isArray(n))
                        for (let e = 0, i = n.length; e < i; e++) {
                            const i = n[e];
                            a(t.shapes, i)
                        } else a(t.shapes, n)
                }
            }
            if (this.isSkinnedMesh && (i.bindMode = this.bindMode, i.bindMatrix = this.bindMatrix.toArray(), void 0 !== this.skeleton && (a(t.skeletons, this.skeleton), i.skeleton = this.skeleton.uuid)), void 0 !== this.material)
                if (Array.isArray(this.material)) {
                    const e = [];
                    for (let n = 0, i = this.material.length; n < i; n++) e.push(a(t.materials, this.material[n]));
                    i.material = e
                } else i.material = a(t.materials, this.material);
            if (this.children.length > 0) {
                i.children = [];
                for (let e = 0; e < this.children.length; e++) i.children.push(this.children[e].toJSON(t).object)
            }
            if (this.animations.length > 0) {
                i.animations = [];
                for (let e = 0; e < this.animations.length; e++) {
                    const n = this.animations[e];
                    i.animations.push(a(t.animations, n))
                }
            }
            if (e) {
                const e = r(t.geometries),
                    i = r(t.materials),
                    a = r(t.textures),
                    s = r(t.images),
                    o = r(t.shapes),
                    l = r(t.skeletons),
                    c = r(t.animations),
                    h = r(t.nodes);
                e.length > 0 && (n.geometries = e), i.length > 0 && (n.materials = i), a.length > 0 && (n.textures = a), s.length > 0 && (n.images = s), o.length > 0 && (n.shapes = o), l.length > 0 && (n.skeletons = l), c.length > 0 && (n.animations = c), h.length > 0 && (n.nodes = h)
            }
            return n.object = i, n;

            function r(t) {
                const e = [];
                for (const n in t) {
                    const i = t[n];
                    delete i.metadata, e.push(i)
                }
                return e
            }
        }
        clone(t) {
            return (new this.constructor).copy(this, t)
        }
        copy(t, e = !0) {
            if (this.name = t.name, this.up.copy(t.up), this.position.copy(t.position), this.rotation.order = t.rotation.order, this.quaternion.copy(t.quaternion), this.scale.copy(t.scale), null !== t.pivot && (this.pivot = t.pivot.clone()), this.matrix.copy(t.matrix), this.matrixWorld.copy(t.matrixWorld), this.matrixAutoUpdate = t.matrixAutoUpdate, this.matrixWorldAutoUpdate = t.matrixWorldAutoUpdate, this.matrixWorldNeedsUpdate = t.matrixWorldNeedsUpdate, this.layers.mask = t.layers.mask, this.visible = t.visible, this.castShadow = t.castShadow, this.receiveShadow = t.receiveShadow, this.frustumCulled = t.frustumCulled, this.renderOrder = t.renderOrder, this.static = t.static, this.animations = t.animations.slice(), this.userData = JSON.parse(JSON.stringify(t.userData)), !0 === e)
                for (let n = 0; n < t.children.length; n++) {
                    const e = t.children[n];
                    this.add(e.clone())
                }
            return this
        }
    };
ne.DEFAULT_UP = new rt(0, 1, 0), ne.DEFAULT_MATRIX_AUTO_UPDATE = !0, ne.DEFAULT_MATRIX_WORLD_AUTO_UPDATE = !0;
var ie = class extends ne {
        constructor() {
            super(), this.isGroup = !0, this.type = "Group"
        }
    },
    ae = {
        type: "move"
    },
    re = class {
        constructor() {
            this._targetRay = null, this._grip = null, this._hand = null
        }
        getHandSpace() {
            return null === this._hand && (this._hand = new ie, this._hand.matrixAutoUpdate = !1, this._hand.visible = !1, this._hand.joints = {}, this._hand.inputState = {
                pinching: !1
            }), this._hand
        }
        getTargetRaySpace() {
            return null === this._targetRay && (this._targetRay = new ie, this._targetRay.matrixAutoUpdate = !1, this._targetRay.visible = !1, this._targetRay.hasLinearVelocity = !1, this._targetRay.linearVelocity = new rt, this._targetRay.hasAngularVelocity = !1, this._targetRay.angularVelocity = new rt), this._targetRay
        }
        getGripSpace() {
            return null === this._grip && (this._grip = new ie, this._grip.matrixAutoUpdate = !1, this._grip.visible = !1, this._grip.hasLinearVelocity = !1, this._grip.linearVelocity = new rt, this._grip.hasAngularVelocity = !1, this._grip.angularVelocity = new rt), this._grip
        }
        dispatchEvent(t) {
            return null !== this._targetRay && this._targetRay.dispatchEvent(t), null !== this._grip && this._grip.dispatchEvent(t), null !== this._hand && this._hand.dispatchEvent(t), this
        }
        connect(t) {
            if (t && t.hand) {
                const e = this._hand;
                if (e)
                    for (const n of t.hand.values()) this._getHandJoint(e, n)
            }
            return this.dispatchEvent({
                type: "connected",
                data: t
            }), this
        }
        disconnect(t) {
            return this.dispatchEvent({
                type: "disconnected",
                data: t
            }), null !== this._targetRay && (this._targetRay.visible = !1), null !== this._grip && (this._grip.visible = !1), null !== this._hand && (this._hand.visible = !1), this
        }
        update(t, e, n) {
            let i = null,
                a = null,
                r = null;
            const s = this._targetRay,
                o = this._grip,
                l = this._hand;
            if (t && "visible-blurred" !== e.session.visibilityState) {
                if (l && t.hand) {
                    r = !0;
                    for (const r of t.hand.values()) {
                        const t = e.getJointPose(r, n),
                            i = this._getHandJoint(l, r);
                        null !== t && (i.matrix.fromArray(t.transform.matrix), i.matrix.decompose(i.position, i.rotation, i.scale), i.matrixWorldNeedsUpdate = !0, i.jointRadius = t.radius), i.visible = null !== t
                    }
                    const i = l.joints["index-finger-tip"],
                        a = l.joints["thumb-tip"],
                        s = i.position.distanceTo(a.position),
                        o = .02,
                        c = .005;
                    l.inputState.pinching && s > o + c ? (l.inputState.pinching = !1, this.dispatchEvent({
                        type: "pinchend",
                        handedness: t.handedness,
                        target: this
                    })) : !l.inputState.pinching && s <= o - c && (l.inputState.pinching = !0, this.dispatchEvent({
                        type: "pinchstart",
                        handedness: t.handedness,
                        target: this
                    }))
                } else null !== o && t.gripSpace && (a = e.getPose(t.gripSpace, n), null !== a && (o.matrix.fromArray(a.transform.matrix), o.matrix.decompose(o.position, o.rotation, o.scale), o.matrixWorldNeedsUpdate = !0, a.linearVelocity ? (o.hasLinearVelocity = !0, o.linearVelocity.copy(a.linearVelocity)) : o.hasLinearVelocity = !1, a.angularVelocity ? (o.hasAngularVelocity = !0, o.angularVelocity.copy(a.angularVelocity)) : o.hasAngularVelocity = !1));
                null !== s && (i = e.getPose(t.targetRaySpace, n), null === i && null !== a && (i = a), null !== i && (s.matrix.fromArray(i.transform.matrix), s.matrix.decompose(s.position, s.rotation, s.scale), s.matrixWorldNeedsUpdate = !0, i.linearVelocity ? (s.hasLinearVelocity = !0, s.linearVelocity.copy(i.linearVelocity)) : s.hasLinearVelocity = !1, i.angularVelocity ? (s.hasAngularVelocity = !0, s.angularVelocity.copy(i.angularVelocity)) : s.hasAngularVelocity = !1, this.dispatchEvent(ae)))
            }
            return null !== s && (s.visible = null !== i), null !== o && (o.visible = null !== a), null !== l && (l.visible = null !== r), this
        }
        _getHandJoint(t, e) {
            if (void 0 === t.joints[e.jointName]) {
                const n = new ie;
                n.matrixAutoUpdate = !1, n.visible = !1, t.joints[e.jointName] = n, t.add(n)
            }
            return t.joints[e.jointName]
        }
    },
    se = {
        aliceblue: 15792383,
        antiquewhite: 16444375,
        aqua: 65535,
        aquamarine: 8388564,
        azure: 15794175,
        beige: 16119260,
        bisque: 16770244,
        black: 0,
        blanchedalmond: 16772045,
        blue: 255,
        blueviolet: 9055202,
        brown: 10824234,
        burlywood: 14596231,
        cadetblue: 6266528,
        chartreuse: 8388352,
        chocolate: 13789470,
        coral: 16744272,
        cornflowerblue: 6591981,
        cornsilk: 16775388,
        crimson: 14423100,
        cyan: 65535,
        darkblue: 139,
        darkcyan: 35723,
        darkgoldenrod: 12092939,
        darkgray: 11119017,
        darkgreen: 25600,
        darkgrey: 11119017,
        darkkhaki: 12433259,
        darkmagenta: 9109643,
        darkolivegreen: 5597999,
        darkorange: 16747520,
        darkorchid: 10040012,
        darkred: 9109504,
        darksalmon: 15308410,
        darkseagreen: 9419919,
        darkslateblue: 4734347,
        darkslategray: 3100495,
        darkslategrey: 3100495,
        darkturquoise: 52945,
        darkviolet: 9699539,
        deeppink: 16716947,
        deepskyblue: 49151,
        dimgray: 6908265,
        dimgrey: 6908265,
        dodgerblue: 2003199,
        firebrick: 11674146,
        floralwhite: 16775920,
        forestgreen: 2263842,
        fuchsia: 16711935,
        gainsboro: 14474460,
        ghostwhite: 16316671,
        gold: 16766720,
        goldenrod: 14329120,
        gray: 8421504,
        green: 32768,
        greenyellow: 11403055,
        grey: 8421504,
        honeydew: 15794160,
        hotpink: 16738740,
        indianred: 13458524,
        indigo: 4915330,
        ivory: 16777200,
        khaki: 15787660,
        lavender: 15132410,
        lavenderblush: 16773365,
        lawngreen: 8190976,
        lemonchiffon: 16775885,
        lightblue: 11393254,
        lightcoral: 15761536,
        lightcyan: 14745599,
        lightgoldenrodyellow: 16448210,
        lightgray: 13882323,
        lightgreen: 9498256,
        lightgrey: 13882323,
        lightpink: 16758465,
        lightsalmon: 16752762,
        lightseagreen: 2142890,
        lightskyblue: 8900346,
        lightslategray: 7833753,
        lightslategrey: 7833753,
        lightsteelblue: 11584734,
        lightyellow: 16777184,
        lime: 65280,
        limegreen: 3329330,
        linen: 16445670,
        magenta: 16711935,
        maroon: 8388608,
        mediumaquamarine: 6737322,
        mediumblue: 205,
        mediumorchid: 12211667,
        mediumpurple: 9662683,
        mediumseagreen: 3978097,
        mediumslateblue: 8087790,
        mediumspringgreen: 64154,
        mediumturquoise: 4772300,
        mediumvioletred: 13047173,
        midnightblue: 1644912,
        mintcream: 16121850,
        mistyrose: 16770273,
        moccasin: 16770229,
        navajowhite: 16768685,
        navy: 128,
        oldlace: 16643558,
        olive: 8421376,
        olivedrab: 7048739,
        orange: 16753920,
        orangered: 16729344,
        orchid: 14315734,
        palegoldenrod: 15657130,
        palegreen: 10025880,
        paleturquoise: 11529966,
        palevioletred: 14381203,
        papayawhip: 16773077,
        peachpuff: 16767673,
        peru: 13468991,
        pink: 16761035,
        plum: 14524637,
        powderblue: 11591910,
        purple: 8388736,
        rebeccapurple: 6697881,
        red: 16711680,
        rosybrown: 12357519,
        royalblue: 4286945,
        saddlebrown: 9127187,
        salmon: 16416882,
        sandybrown: 16032864,
        seagreen: 3050327,
        seashell: 16774638,
        sienna: 10506797,
        silver: 12632256,
        skyblue: 8900331,
        slateblue: 6970061,
        slategray: 7372944,
        slategrey: 7372944,
        snow: 16775930,
        springgreen: 65407,
        steelblue: 4620980,
        tan: 13808780,
        teal: 32896,
        thistle: 14204888,
        tomato: 16737095,
        turquoise: 4251856,
        violet: 15631086,
        wheat: 16113331,
        white: 16777215,
        whitesmoke: 16119285,
        yellow: 16776960,
        yellowgreen: 10145074
    },
    oe = {
        h: 0,
        s: 0,
        l: 0
    },
    le = {
        h: 0,
        s: 0,
        l: 0
    };

function ce(t, e, n) {
    return n < 0 && (n += 1), n > 1 && (n -= 1), n < 1 / 6 ? t + 6 * (e - t) * n : n < .5 ? e : n < 2 / 3 ? t + 6 * (e - t) * (2 / 3 - n) : t
}
var he = class {
        constructor(t, e, n) {
            return this.isColor = !0, this.r = 1, this.g = 1, this.b = 1, this.set(t, e, n)
        }
        set(t, e, n) {
            if (void 0 === e && void 0 === n) {
                const e = t;
                e && e.isColor ? this.copy(e) : "number" == typeof e ? this.setHex(e) : "string" == typeof e && this.setStyle(e)
            } else this.setRGB(t, e, n);
            return this
        }
        setScalar(t) {
            return this.r = t, this.g = t, this.b = t, this
        }
        setHex(t, e = P) {
            return t = Math.floor(t), this.r = (t >> 16 & 255) / 255, this.g = (t >> 8 & 255) / 255, this.b = (255 & t) / 255, mt.colorSpaceToWorking(this, e), this
        }
        setRGB(t, e, n, i = mt.workingColorSpace) {
            return this.r = t, this.g = e, this.b = n, mt.colorSpaceToWorking(this, i), this
        }
        setHSL(t, e, n, i = mt.workingColorSpace) {
            if (t = $(t, 1), e = J(e, 0, 1), n = J(n, 0, 1), 0 === e) this.r = this.g = this.b = n;
            else {
                const i = n <= .5 ? n * (1 + e) : n + e - n * e,
                    a = 2 * n - i;
                this.r = ce(a, i, t + 1 / 3), this.g = ce(a, i, t), this.b = ce(a, i, t - 1 / 3)
            }
            return mt.colorSpaceToWorking(this, i), this
        }
        setStyle(t, e = P) {
            function n(e) {
                void 0 !== e && parseFloat(e) < 1 && k("Color: Alpha component of " + t + " will be ignored.")
            }
            let i;
            if (i = /^(\w+)\(([^\)]*)\)/.exec(t)) {
                let a;
                const r = i[1],
                    s = i[2];
                switch (r) {
                    case "rgb":
                    case "rgba":
                        if (a = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(s)) return n(a[4]), this.setRGB(Math.min(255, parseInt(a[1], 10)) / 255, Math.min(255, parseInt(a[2], 10)) / 255, Math.min(255, parseInt(a[3], 10)) / 255, e);
                        if (a = /^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(s)) return n(a[4]), this.setRGB(Math.min(100, parseInt(a[1], 10)) / 100, Math.min(100, parseInt(a[2], 10)) / 100, Math.min(100, parseInt(a[3], 10)) / 100, e);
                        break;
                    case "hsl":
                    case "hsla":
                        if (a = /^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(s)) return n(a[4]), this.setHSL(parseFloat(a[1]) / 360, parseFloat(a[2]) / 100, parseFloat(a[3]) / 100, e);
                        break;
                    default:
                        k("Color: Unknown color model " + t)
                }
            } else if (i = /^\#([A-Fa-f\d]+)$/.exec(t)) {
                const n = i[1],
                    a = n.length;
                if (3 === a) return this.setRGB(parseInt(n.charAt(0), 16) / 15, parseInt(n.charAt(1), 16) / 15, parseInt(n.charAt(2), 16) / 15, e);
                if (6 === a) return this.setHex(parseInt(n, 16), e);
                k("Color: Invalid hex color " + t)
            } else if (t && t.length > 0) return this.setColorName(t, e);
            return this
        }
        setColorName(t, e = P) {
            const n = se[t.toLowerCase()];
            return void 0 !== n ? this.setHex(n, e) : k("Color: Unknown color " + t), this
        }
        clone() {
            return new this.constructor(this.r, this.g, this.b)
        }
        copy(t) {
            return this.r = t.r, this.g = t.g, this.b = t.b, this
        }
        copySRGBToLinear(t) {
            return this.r = ft(t.r), this.g = ft(t.g), this.b = ft(t.b), this
        }
        copyLinearToSRGB(t) {
            return this.r = gt(t.r), this.g = gt(t.g), this.b = gt(t.b), this
        }
        convertSRGBToLinear() {
            return this.copySRGBToLinear(this), this
        }
        convertLinearToSRGB() {
            return this.copyLinearToSRGB(this), this
        }
        getHex(t = P) {
            return mt.workingToColorSpace(ue.copy(this), t), 65536 * Math.round(J(255 * ue.r, 0, 255)) + 256 * Math.round(J(255 * ue.g, 0, 255)) + Math.round(J(255 * ue.b, 0, 255))
        }
        getHexString(t = P) {
            return ("000000" + this.getHex(t).toString(16)).slice(-6)
        }
        getHSL(t, e = mt.workingColorSpace) {
            mt.workingToColorSpace(ue.copy(this), e);
            const n = ue.r,
                i = ue.g,
                a = ue.b,
                r = Math.max(n, i, a),
                s = Math.min(n, i, a);
            let o, l;
            const c = (s + r) / 2;
            if (s === r) o = 0, l = 0;
            else {
                const t = r - s;
                switch (l = c <= .5 ? t / (r + s) : t / (2 - r - s), r) {
                    case n:
                        o = (i - a) / t + (i < a ? 6 : 0);
                        break;
                    case i:
                        o = (a - n) / t + 2;
                        break;
                    case a:
                        o = (n - i) / t + 4
                }
                o /= 6
            }
            return t.h = o, t.s = l, t.l = c, t
        }
        getRGB(t, e = mt.workingColorSpace) {
            return mt.workingToColorSpace(ue.copy(this), e), t.r = ue.r, t.g = ue.g, t.b = ue.b, t
        }
        getStyle(t = P) {
            mt.workingToColorSpace(ue.copy(this), t);
            const e = ue.r,
                n = ue.g,
                i = ue.b;
            return "srgb" !== t ? `color(${t} ${e.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})` : `rgb(${Math.round(255*e)},${Math.round(255*n)},${Math.round(255*i)})`
        }
        offsetHSL(t, e, n) {
            return this.getHSL(oe), this.setHSL(oe.h + t, oe.s + e, oe.l + n)
        }
        add(t) {
            return this.r += t.r, this.g += t.g, this.b += t.b, this
        }
        addColors(t, e) {
            return this.r = t.r + e.r, this.g = t.g + e.g, this.b = t.b + e.b, this
        }
        addScalar(t) {
            return this.r += t, this.g += t, this.b += t, this
        }
        sub(t) {
            return this.r = Math.max(0, this.r - t.r), this.g = Math.max(0, this.g - t.g), this.b = Math.max(0, this.b - t.b), this
        }
        multiply(t) {
            return this.r *= t.r, this.g *= t.g, this.b *= t.b, this
        }
        multiplyScalar(t) {
            return this.r *= t, this.g *= t, this.b *= t, this
        }
        lerp(t, e) {
            return this.r += (t.r - this.r) * e, this.g += (t.g - this.g) * e, this.b += (t.b - this.b) * e, this
        }
        lerpColors(t, e, n) {
            return this.r = t.r + (e.r - t.r) * n, this.g = t.g + (e.g - t.g) * n, this.b = t.b + (e.b - t.b) * n, this
        }
        lerpHSL(t, e) {
            this.getHSL(oe), t.getHSL(le);
            const n = Q(oe.h, le.h, e),
                i = Q(oe.s, le.s, e),
                a = Q(oe.l, le.l, e);
            return this.setHSL(n, i, a), this
        }
        setFromVector3(t) {
            return this.r = t.x, this.g = t.y, this.b = t.z, this
        }
        applyMatrix3(t) {
            const e = this.r,
                n = this.g,
                i = this.b,
                a = t.elements;
            return this.r = a[0] * e + a[3] * n + a[6] * i, this.g = a[1] * e + a[4] * n + a[7] * i, this.b = a[2] * e + a[5] * n + a[8] * i, this
        }
        equals(t) {
            return t.r === this.r && t.g === this.g && t.b === this.b
        }
        fromArray(t, e = 0) {
            return this.r = t[e], this.g = t[e + 1], this.b = t[e + 2], this
        }
        toArray(t = [], e = 0) {
            return t[e] = this.r, t[e + 1] = this.g, t[e + 2] = this.b, t
        }
        fromBufferAttribute(t, e) {
            return this.r = t.getX(e), this.g = t.getY(e), this.b = t.getZ(e), this
        }
        toJSON() {
            return this.getHex()
        }*[Symbol.iterator]() {
            yield this.r, yield this.g, yield this.b
        }
    },
    ue = new he;
he.NAMES = se;
var de = class extends ne {
        constructor() {
            super(), this.isScene = !0, this.type = "Scene", this.background = null, this.environment = null, this.fog = null, this.backgroundBlurriness = 0, this.backgroundIntensity = 1, this.backgroundRotation = new zt, this.environmentIntensity = 1, this.environmentRotation = new zt, this.overrideMaterial = null, "undefined" != typeof __THREE_DEVTOOLS__ && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe", {
                detail: this
            }))
        }
        copy(t, e) {
            return super.copy(t, e), null !== t.background && (this.background = t.background.clone()), null !== t.environment && (this.environment = t.environment.clone()), null !== t.fog && (this.fog = t.fog.clone()), this.backgroundBlurriness = t.backgroundBlurriness, this.backgroundIntensity = t.backgroundIntensity, this.backgroundRotation.copy(t.backgroundRotation), this.environmentIntensity = t.environmentIntensity, this.environmentRotation.copy(t.environmentRotation), null !== t.overrideMaterial && (this.overrideMaterial = t.overrideMaterial.clone()), this.matrixAutoUpdate = t.matrixAutoUpdate, this
        }
        toJSON(t) {
            const e = super.toJSON(t);
            return null !== this.fog && (e.object.fog = this.fog.toJSON()), this.backgroundBlurriness > 0 && (e.object.backgroundBlurriness = this.backgroundBlurriness), 1 !== this.backgroundIntensity && (e.object.backgroundIntensity = this.backgroundIntensity), e.object.backgroundRotation = this.backgroundRotation.toArray(), 1 !== this.environmentIntensity && (e.object.environmentIntensity = this.environmentIntensity), e.object.environmentRotation = this.environmentRotation.toArray(), e
        }
    },
    pe = new rt,
    me = new rt,
    fe = new rt,
    ge = new rt,
    _e = new rt,
    ve = new rt,
    xe = new rt,
    Me = new rt,
    be = new rt,
    ye = new rt,
    Se = new Et,
    Ee = new Et,
    Te = new Et,
    we = class t {
        constructor(t = new rt, e = new rt, n = new rt) {
            this.a = t, this.b = e, this.c = n
        }
        static getNormal(t, e, n, i) {
            i.subVectors(n, e), pe.subVectors(t, e), i.cross(pe);
            const a = i.lengthSq();
            return a > 0 ? i.multiplyScalar(1 / Math.sqrt(a)) : i.set(0, 0, 0)
        }
        static getBarycoord(t, e, n, i, a) {
            pe.subVectors(i, e), me.subVectors(n, e), fe.subVectors(t, e);
            const r = pe.dot(pe),
                s = pe.dot(me),
                o = pe.dot(fe),
                l = me.dot(me),
                c = me.dot(fe),
                h = r * l - s * s;
            if (0 === h) return a.set(0, 0, 0), null;
            const u = 1 / h,
                d = (l * o - s * c) * u,
                p = (r * c - s * o) * u;
            return a.set(1 - d - p, p, d)
        }
        static containsPoint(t, e, n, i) {
            return null !== this.getBarycoord(t, e, n, i, ge) && (ge.x >= 0 && ge.y >= 0 && ge.x + ge.y <= 1)
        }
        static getInterpolation(t, e, n, i, a, r, s, o) {
            return null === this.getBarycoord(t, e, n, i, ge) ? (o.x = 0, o.y = 0, "z" in o && (o.z = 0), "w" in o && (o.w = 0), null) : (o.setScalar(0), o.addScaledVector(a, ge.x), o.addScaledVector(r, ge.y), o.addScaledVector(s, ge.z), o)
        }
        static getInterpolatedAttribute(t, e, n, i, a, r) {
            return Se.setScalar(0), Ee.setScalar(0), Te.setScalar(0), Se.fromBufferAttribute(t, e), Ee.fromBufferAttribute(t, n), Te.fromBufferAttribute(t, i), r.setScalar(0), r.addScaledVector(Se, a.x), r.addScaledVector(Ee, a.y), r.addScaledVector(Te, a.z), r
        }
        static isFrontFacing(t, e, n, i) {
            return pe.subVectors(n, e), me.subVectors(t, e), pe.cross(me).dot(i) < 0
        }
        set(t, e, n) {
            return this.a.copy(t), this.b.copy(e), this.c.copy(n), this
        }
        setFromPointsAndIndices(t, e, n, i) {
            return this.a.copy(t[e]), this.b.copy(t[n]), this.c.copy(t[i]), this
        }
        setFromAttributeAndIndices(t, e, n, i) {
            return this.a.fromBufferAttribute(t, e), this.b.fromBufferAttribute(t, n), this.c.fromBufferAttribute(t, i), this
        }
        clone() {
            return (new this.constructor).copy(this)
        }
        copy(t) {
            return this.a.copy(t.a), this.b.copy(t.b), this.c.copy(t.c), this
        }
        getArea() {
            return pe.subVectors(this.c, this.b), me.subVectors(this.a, this.b), .5 * pe.cross(me).length()
        }
        getMidpoint(t) {
            return t.addVectors(this.a, this.b).add(this.c).multiplyScalar(1 / 3)
        }
        getNormal(e) {
            return t.getNormal(this.a, this.b, this.c, e)
        }
        getPlane(t) {
            return t.setFromCoplanarPoints(this.a, this.b, this.c)
        }
        getBarycoord(e, n) {
            return t.getBarycoord(e, this.a, this.b, this.c, n)
        }
        getInterpolation(e, n, i, a, r) {
            return t.getInterpolation(e, this.a, this.b, this.c, n, i, a, r)
        }
        containsPoint(e) {
            return t.containsPoint(e, this.a, this.b, this.c)
        }
        isFrontFacing(e) {
            return t.isFrontFacing(this.a, this.b, this.c, e)
        }
        intersectsBox(t) {
            return t.intersectsTriangle(this)
        }
        closestPointToPoint(t, e) {
            const n = this.a,
                i = this.b,
                a = this.c;
            let r, s;
            _e.subVectors(i, n), ve.subVectors(a, n), Me.subVectors(t, n);
            const o = _e.dot(Me),
                l = ve.dot(Me);
            if (o <= 0 && l <= 0) return e.copy(n);
            be.subVectors(t, i);
            const c = _e.dot(be),
                h = ve.dot(be);
            if (c >= 0 && h <= c) return e.copy(i);
            const u = o * h - c * l;
            if (u <= 0 && o >= 0 && c <= 0) return r = o / (o - c), e.copy(n).addScaledVector(_e, r);
            ye.subVectors(t, a);
            const d = _e.dot(ye),
                p = ve.dot(ye);
            if (p >= 0 && d <= p) return e.copy(a);
            const m = d * l - o * p;
            if (m <= 0 && l >= 0 && p <= 0) return s = l / (l - p), e.copy(n).addScaledVector(ve, s);
            const f = c * p - d * h;
            if (f <= 0 && h - c >= 0 && d - p >= 0) return xe.subVectors(a, i), s = (h - c) / (h - c + (d - p)), e.copy(i).addScaledVector(xe, s);
            const g = 1 / (f + m + u);
            return r = m * g, s = u * g, e.copy(n).addScaledVector(_e, r).addScaledVector(ve, s)
        }
        equals(t) {
            return t.a.equals(this.a) && t.b.equals(this.b) && t.c.equals(this.c)
        }
    },
    Ae = class {
        constructor(t = new rt(1 / 0, 1 / 0, 1 / 0), e = new rt(-1 / 0, -1 / 0, -1 / 0)) {
            this.isBox3 = !0, this.min = t, this.max = e
        }
        set(t, e) {
            return this.min.copy(t), this.max.copy(e), this
        }
        setFromArray(t) {
            this.makeEmpty();
            for (let e = 0, n = t.length; e < n; e += 3) this.expandByPoint(Ce.fromArray(t, e));
            return this
        }
        setFromBufferAttribute(t) {
            this.makeEmpty();
            for (let e = 0, n = t.count; e < n; e++) this.expandByPoint(Ce.fromBufferAttribute(t, e));
            return this
        }
        setFromPoints(t) {
            this.makeEmpty();
            for (let e = 0, n = t.length; e < n; e++) this.expandByPoint(t[e]);
            return this
        }
        setFromCenterAndSize(t, e) {
            const n = Ce.copy(e).multiplyScalar(.5);
            return this.min.copy(t).sub(n), this.max.copy(t).add(n), this
        }
        setFromObject(t, e = !1) {
            return this.makeEmpty(), this.expandByObject(t, e)
        }
        clone() {
            return (new this.constructor).copy(this)
        }
        copy(t) {
            return this.min.copy(t.min), this.max.copy(t.max), this
        }
        makeEmpty() {
            return this.min.x = this.min.y = this.min.z = 1 / 0, this.max.x = this.max.y = this.max.z = -1 / 0, this
        }
        isEmpty() {
            return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z
        }
        getCenter(t) {
            return this.isEmpty() ? t.set(0, 0, 0) : t.addVectors(this.min, this.max).multiplyScalar(.5)
        }
        getSize(t) {
            return this.isEmpty() ? t.set(0, 0, 0) : t.subVectors(this.max, this.min)
        }
        expandByPoint(t) {
            return this.min.min(t), this.max.max(t), this
        }
        expandByVector(t) {
            return this.min.sub(t), this.max.add(t), this
        }
        expandByScalar(t) {
            return this.min.addScalar(-t), this.max.addScalar(t), this
        }
        expandByObject(t, e = !1) {
            t.updateWorldMatrix(!1, !1);
            const n = t.geometry;
            if (void 0 !== n) {
                const i = n.getAttribute("position");
                if (!0 === e && void 0 !== i && !0 !== t.isInstancedMesh)
                    for (let e = 0, n = i.count; e < n; e++) !0 === t.isMesh ? t.getVertexPosition(e, Ce) : Ce.fromBufferAttribute(i, e), Ce.applyMatrix4(t.matrixWorld), this.expandByPoint(Ce);
                else void 0 !== t.boundingBox ? (null === t.boundingBox && t.computeBoundingBox(), Pe.copy(t.boundingBox)) : (null === n.boundingBox && n.computeBoundingBox(), Pe.copy(n.boundingBox)), Pe.applyMatrix4(t.matrixWorld), this.union(Pe)
            }
            const i = t.children;
            for (let a = 0, r = i.length; a < r; a++) this.expandByObject(i[a], e);
            return this
        }
        containsPoint(t) {
            return t.x >= this.min.x && t.x <= this.max.x && t.y >= this.min.y && t.y <= this.max.y && t.z >= this.min.z && t.z <= this.max.z
        }
        containsBox(t) {
            return this.min.x <= t.min.x && t.max.x <= this.max.x && this.min.y <= t.min.y && t.max.y <= this.max.y && this.min.z <= t.min.z && t.max.z <= this.max.z
        }
        getParameter(t, e) {
            return e.set((t.x - this.min.x) / (this.max.x - this.min.x), (t.y - this.min.y) / (this.max.y - this.min.y), (t.z - this.min.z) / (this.max.z - this.min.z))
        }
        intersectsBox(t) {
            return t.max.x >= this.min.x && t.min.x <= this.max.x && t.max.y >= this.min.y && t.min.y <= this.max.y && t.max.z >= this.min.z && t.min.z <= this.max.z
        }
        intersectsSphere(t) {
            return this.clampPoint(t.center, Ce), Ce.distanceToSquared(t.center) <= t.radius * t.radius
        }
        intersectsPlane(t) {
            let e, n;
            return t.normal.x > 0 ? (e = t.normal.x * this.min.x, n = t.normal.x * this.max.x) : (e = t.normal.x * this.max.x, n = t.normal.x * this.min.x), t.normal.y > 0 ? (e += t.normal.y * this.min.y, n += t.normal.y * this.max.y) : (e += t.normal.y * this.max.y, n += t.normal.y * this.min.y), t.normal.z > 0 ? (e += t.normal.z * this.min.z, n += t.normal.z * this.max.z) : (e += t.normal.z * this.max.z, n += t.normal.z * this.min.z), e <= -t.constant && n >= -t.constant
        }
        intersectsTriangle(t) {
            if (this.isEmpty()) return !1;
            this.getCenter(Fe), Be.subVectors(this.max, Fe), De.subVectors(t.a, Fe), Le.subVectors(t.b, Fe), Ie.subVectors(t.c, Fe), Ue.subVectors(Le, De), Ne.subVectors(Ie, Le), Oe.subVectors(De, Ie);
            let e = [0, -Ue.z, Ue.y, 0, -Ne.z, Ne.y, 0, -Oe.z, Oe.y, Ue.z, 0, -Ue.x, Ne.z, 0, -Ne.x, Oe.z, 0, -Oe.x, -Ue.y, Ue.x, 0, -Ne.y, Ne.x, 0, -Oe.y, Oe.x, 0];
            return !!ke(e, De, Le, Ie, Be) && (e = [1, 0, 0, 0, 1, 0, 0, 0, 1], !!ke(e, De, Le, Ie, Be) && (ze.crossVectors(Ue, Ne), e = [ze.x, ze.y, ze.z], ke(e, De, Le, Ie, Be)))
        }
        clampPoint(t, e) {
            return e.copy(t).clamp(this.min, this.max)
        }
        distanceToPoint(t) {
            return this.clampPoint(t, Ce).distanceTo(t)
        }
        getBoundingSphere(t) {
            return this.isEmpty() ? t.makeEmpty() : (this.getCenter(t.center), t.radius = .5 * this.getSize(Ce).length()), t
        }
        intersect(t) {
            return this.min.max(t.min), this.max.min(t.max), this.isEmpty() && this.makeEmpty(), this
        }
        union(t) {
            return this.min.min(t.min), this.max.max(t.max), this
        }
        applyMatrix4(t) {
            return this.isEmpty() || (Re[0].set(this.min.x, this.min.y, this.min.z).applyMatrix4(t), Re[1].set(this.min.x, this.min.y, this.max.z).applyMatrix4(t), Re[2].set(this.min.x, this.max.y, this.min.z).applyMatrix4(t), Re[3].set(this.min.x, this.max.y, this.max.z).applyMatrix4(t), Re[4].set(this.max.x, this.min.y, this.min.z).applyMatrix4(t), Re[5].set(this.max.x, this.min.y, this.max.z).applyMatrix4(t), Re[6].set(this.max.x, this.max.y, this.min.z).applyMatrix4(t), Re[7].set(this.max.x, this.max.y, this.max.z).applyMatrix4(t), this.setFromPoints(Re)), this
        }
        translate(t) {
            return this.min.add(t), this.max.add(t), this
        }
        equals(t) {
            return t.min.equals(this.min) && t.max.equals(this.max)
        }
        toJSON() {
            return {
                min: this.min.toArray(),
                max: this.max.toArray()
            }
        }
        fromJSON(t) {
            return this.min.fromArray(t.min), this.max.fromArray(t.max), this
        }
    },
    Re = [new rt, new rt, new rt, new rt, new rt, new rt, new rt, new rt],
    Ce = new rt,
    Pe = new Ae,
    De = new rt,
    Le = new rt,
    Ie = new rt,
    Ue = new rt,
    Ne = new rt,
    Oe = new rt,
    Fe = new rt,
    Be = new rt,
    ze = new rt,
    Ve = new rt;

function ke(t, e, n, i, a) {
    for (let r = 0, s = t.length - 3; r <= s; r += 3) {
        Ve.fromArray(t, r);
        const s = a.x * Math.abs(Ve.x) + a.y * Math.abs(Ve.y) + a.z * Math.abs(Ve.z),
            o = e.dot(Ve),
            l = n.dot(Ve),
            c = i.dot(Ve);
        if (Math.max(-Math.max(o, l, c), Math.min(o, l, c)) > s) return !1
    }
    return !0
}
var He, Ge = new rt,
    We = new it,
    Xe = 0,
    Ye = class {
        constructor(t, e, n = !1) {
            if (Array.isArray(t)) throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");
            this.isBufferAttribute = !0, Object.defineProperty(this, "id", {
                value: Xe++
            }), this.name = "", this.array = t, this.itemSize = e, this.count = void 0 !== t ? t.length / e : 0, this.normalized = n, this.usage = 35044, this.updateRanges = [], this.gpuType = M, this.version = 0
        }
        onUploadCallback() {}
        set needsUpdate(t) {
            !0 === t && this.version++
        }
        setUsage(t) {
            return this.usage = t, this
        }
        addUpdateRange(t, e) {
            this.updateRanges.push({
                start: t,
                count: e
            })
        }
        clearUpdateRanges() {
            this.updateRanges.length = 0
        }
        copy(t) {
            return this.name = t.name, this.array = new t.array.constructor(t.array), this.itemSize = t.itemSize, this.count = t.count, this.normalized = t.normalized, this.usage = t.usage, this.gpuType = t.gpuType, this
        }
        copyAt(t, e, n) {
            t *= this.itemSize, n *= e.itemSize;
            for (let i = 0, a = this.itemSize; i < a; i++) this.array[t + i] = e.array[n + i];
            return this
        }
        copyArray(t) {
            return this.array.set(t), this
        }
        applyMatrix3(t) {
            if (2 === this.itemSize)
                for (let e = 0, n = this.count; e < n; e++) We.fromBufferAttribute(this, e), We.applyMatrix3(t), this.setXY(e, We.x, We.y);
            else if (3 === this.itemSize)
                for (let e = 0, n = this.count; e < n; e++) Ge.fromBufferAttribute(this, e), Ge.applyMatrix3(t), this.setXYZ(e, Ge.x, Ge.y, Ge.z);
            return this
        }
        applyMatrix4(t) {
            for (let e = 0, n = this.count; e < n; e++) Ge.fromBufferAttribute(this, e), Ge.applyMatrix4(t), this.setXYZ(e, Ge.x, Ge.y, Ge.z);
            return this
        }
        applyNormalMatrix(t) {
            for (let e = 0, n = this.count; e < n; e++) Ge.fromBufferAttribute(this, e), Ge.applyNormalMatrix(t), this.setXYZ(e, Ge.x, Ge.y, Ge.z);
            return this
        }
        transformDirection(t) {
            for (let e = 0, n = this.count; e < n; e++) Ge.fromBufferAttribute(this, e), Ge.transformDirection(t), this.setXYZ(e, Ge.x, Ge.y, Ge.z);
            return this
        }
        set(t, e = 0) {
            return this.array.set(t, e), this
        }
        getComponent(t, e) {
            let n = this.array[t * this.itemSize + e];
            return this.normalized && (n = tt(n, this.array)), n
        }
        setComponent(t, e, n) {
            return this.normalized && (n = et(n, this.array)), this.array[t * this.itemSize + e] = n, this
        }
        getX(t) {
            let e = this.array[t * this.itemSize];
            return this.normalized && (e = tt(e, this.array)), e
        }
        setX(t, e) {
            return this.normalized && (e = et(e, this.array)), this.array[t * this.itemSize] = e, this
        }
        getY(t) {
            let e = this.array[t * this.itemSize + 1];
            return this.normalized && (e = tt(e, this.array)), e
        }
        setY(t, e) {
            return this.normalized && (e = et(e, this.array)), this.array[t * this.itemSize + 1] = e, this
        }
        getZ(t) {
            let e = this.array[t * this.itemSize + 2];
            return this.normalized && (e = tt(e, this.array)), e
        }
        setZ(t, e) {
            return this.normalized && (e = et(e, this.array)), this.array[t * this.itemSize + 2] = e, this
        }
        getW(t) {
            let e = this.array[t * this.itemSize + 3];
            return this.normalized && (e = tt(e, this.array)), e
        }
        setW(t, e) {
            return this.normalized && (e = et(e, this.array)), this.array[t * this.itemSize + 3] = e, this
        }
        setXY(t, e, n) {
            return t *= this.itemSize, this.normalized && (e = et(e, this.array), n = et(n, this.array)), this.array[t + 0] = e, this.array[t + 1] = n, this
        }
        setXYZ(t, e, n, i) {
            return t *= this.itemSize, this.normalized && (e = et(e, this.array), n = et(n, this.array), i = et(i, this.array)), this.array[t + 0] = e, this.array[t + 1] = n, this.array[t + 2] = i, this
        }
        setXYZW(t, e, n, i, a) {
            return t *= this.itemSize, this.normalized && (e = et(e, this.array), n = et(n, this.array), i = et(i, this.array), a = et(a, this.array)), this.array[t + 0] = e, this.array[t + 1] = n, this.array[t + 2] = i, this.array[t + 3] = a, this
        }
        onUpload(t) {
            return this.onUploadCallback = t, this
        }
        clone() {
            return new this.constructor(this.array, this.itemSize).copy(this)
        }
        toJSON() {
            const t = {
                itemSize: this.itemSize,
                type: this.array.constructor.name,
                array: Array.from(this.array),
                normalized: this.normalized
            };
            return "" !== this.name && (t.name = this.name), 35044 !== this.usage && (t.usage = this.usage), t
        }
    },
    je = class extends Ye {
        constructor(t, e, n) {
            super(new Uint16Array(t), e, n)
        }
    },
    qe = class extends Ye {
        constructor(t, e, n) {
            super(new Uint32Array(t), e, n)
        }
    },
    Ze = class extends Ye {
        constructor(t, e, n) {
            super(new Float32Array(t), e, n)
        }
    },
    Ke = new Ae,
    Je = new rt,
    $e = new rt,
    Qe = class {
        constructor(t = new rt, e = -1) {
            this.isSphere = !0, this.center = t, this.radius = e
        }
        set(t, e) {
            return this.center.copy(t), this.radius = e, this
        }
        setFromPoints(t, e) {
            const n = this.center;
            void 0 !== e ? n.copy(e) : Ke.setFromPoints(t).getCenter(n);
            let i = 0;
            for (let a = 0, r = t.length; a < r; a++) i = Math.max(i, n.distanceToSquared(t[a]));
            return this.radius = Math.sqrt(i), this
        }
        copy(t) {
            return this.center.copy(t.center), this.radius = t.radius, this
        }
        isEmpty() {
            return this.radius < 0
        }
        makeEmpty() {
            return this.center.set(0, 0, 0), this.radius = -1, this
        }
        containsPoint(t) {
            return t.distanceToSquared(this.center) <= this.radius * this.radius
        }
        distanceToPoint(t) {
            return t.distanceTo(this.center) - this.radius
        }
        intersectsSphere(t) {
            const e = this.radius + t.radius;
            return t.center.distanceToSquared(this.center) <= e * e
        }
        intersectsBox(t) {
            return t.intersectsSphere(this)
        }
        intersectsPlane(t) {
            return Math.abs(t.distanceToPoint(this.center)) <= this.radius
        }
        clampPoint(t, e) {
            const n = this.center.distanceToSquared(t);
            return e.copy(t), n > this.radius * this.radius && (e.sub(this.center).normalize(), e.multiplyScalar(this.radius).add(this.center)), e
        }
        getBoundingBox(t) {
            return this.isEmpty() ? (t.makeEmpty(), t) : (t.set(this.center, this.center), t.expandByScalar(this.radius), t)
        }
        applyMatrix4(t) {
            return this.center.applyMatrix4(t), this.radius = this.radius * t.getMaxScaleOnAxis(), this
        }
        translate(t) {
            return this.center.add(t), this
        }
        expandByPoint(t) {
            if (this.isEmpty()) return this.center.copy(t), this.radius = 0, this;
            Je.subVectors(t, this.center);
            const e = Je.lengthSq();
            if (e > this.radius * this.radius) {
                const t = Math.sqrt(e),
                    n = .5 * (t - this.radius);
                this.center.addScaledVector(Je, n / t), this.radius += n
            }
            return this
        }
        union(t) {
            return t.isEmpty() ? this : this.isEmpty() ? (this.copy(t), this) : (!0 === this.center.equals(t.center) ? this.radius = Math.max(this.radius, t.radius) : ($e.subVectors(t.center, this.center).setLength(t.radius), this.expandByPoint(Je.copy(t.center).add($e)), this.expandByPoint(Je.copy(t.center).sub($e))), this)
        }
        equals(t) {
            return t.center.equals(this.center) && t.radius === this.radius
        }
        clone() {
            return (new this.constructor).copy(this)
        }
        toJSON() {
            return {
                radius: this.radius,
                center: this.center.toArray()
            }
        }
        fromJSON(t) {
            return this.radius = t.radius, this.center.fromArray(t.center), this
        }
    },
    tn = 0,
    en = new Ct,
    nn = new ne,
    an = new rt,
    rn = new Ae,
    sn = new Ae,
    on = new rt,
    ln = class t extends X {
        constructor() {
            super(), this.isBufferGeometry = !0, Object.defineProperty(this, "id", {
                value: tn++
            }), this.uuid = K(), this.name = "", this.type = "BufferGeometry", this.index = null, this.indirect = null, this.indirectOffset = 0, this.attributes = {}, this.morphAttributes = {}, this.morphTargetsRelative = !1, this.groups = [], this.boundingBox = null, this.boundingSphere = null, this.drawRange = {
                start: 0,
                count: 1 / 0
            }, this.userData = {}
        }
        getIndex() {
            return this.index
        }
        setIndex(t) {
            return Array.isArray(t) ? this.index = new(function(t) {
                for (let e = t.length - 1; e >= 0; --e)
                    if (t[e] >= 65535) return !0;
                return !1
            }(t) ? qe : je)(t, 1) : this.index = t, this
        }
        setIndirect(t, e = 0) {
            return this.indirect = t, this.indirectOffset = e, this
        }
        getIndirect() {
            return this.indirect
        }
        getAttribute(t) {
            return this.attributes[t]
        }
        setAttribute(t, e) {
            return this.attributes[t] = e, this
        }
        deleteAttribute(t) {
            return delete this.attributes[t], this
        }
        hasAttribute(t) {
            return void 0 !== this.attributes[t]
        }
        addGroup(t, e, n = 0) {
            this.groups.push({
                start: t,
                count: e,
                materialIndex: n
            })
        }
        clearGroups() {
            this.groups = []
        }
        setDrawRange(t, e) {
            this.drawRange.start = t, this.drawRange.count = e
        }
        applyMatrix4(t) {
            const e = this.attributes.position;
            void 0 !== e && (e.applyMatrix4(t), e.needsUpdate = !0);
            const n = this.attributes.normal;
            if (void 0 !== n) {
                const e = (new lt).getNormalMatrix(t);
                n.applyNormalMatrix(e), n.needsUpdate = !0
            }
            const i = this.attributes.tangent;
            return void 0 !== i && (i.transformDirection(t), i.needsUpdate = !0), null !== this.boundingBox && this.computeBoundingBox(), null !== this.boundingSphere && this.computeBoundingSphere(), this
        }
        applyQuaternion(t) {
            return en.makeRotationFromQuaternion(t), this.applyMatrix4(en), this
        }
        rotateX(t) {
            return en.makeRotationX(t), this.applyMatrix4(en), this
        }
        rotateY(t) {
            return en.makeRotationY(t), this.applyMatrix4(en), this
        }
        rotateZ(t) {
            return en.makeRotationZ(t), this.applyMatrix4(en), this
        }
        translate(t, e, n) {
            return en.makeTranslation(t, e, n), this.applyMatrix4(en), this
        }
        scale(t, e, n) {
            return en.makeScale(t, e, n), this.applyMatrix4(en), this
        }
        lookAt(t) {
            return nn.lookAt(t), nn.updateMatrix(), this.applyMatrix4(nn.matrix), this
        }
        center() {
            return this.computeBoundingBox(), this.boundingBox.getCenter(an).negate(), this.translate(an.x, an.y, an.z), this
        }
        setFromPoints(t) {
            const e = this.getAttribute("position");
            if (void 0 === e) {
                const e = [];
                for (let n = 0, i = t.length; n < i; n++) {
                    const i = t[n];
                    e.push(i.x, i.y, i.z || 0)
                }
                this.setAttribute("position", new Ze(e, 3))
            } else {
                const n = Math.min(t.length, e.count);
                for (let i = 0; i < n; i++) {
                    const n = t[i];
                    e.setXYZ(i, n.x, n.y, n.z || 0)
                }
                t.length > e.count && k("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."), e.needsUpdate = !0
            }
            return this
        }
        computeBoundingBox() {
            null === this.boundingBox && (this.boundingBox = new Ae);
            const t = this.attributes.position,
                e = this.morphAttributes.position;
            if (t && t.isGLBufferAttribute) return H("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.", this), void this.boundingBox.set(new rt(-1 / 0, -1 / 0, -1 / 0), new rt(1 / 0, 1 / 0, 1 / 0));
            if (void 0 !== t) {
                if (this.boundingBox.setFromBufferAttribute(t), e)
                    for (let n = 0, i = e.length; n < i; n++) {
                        const t = e[n];
                        rn.setFromBufferAttribute(t), this.morphTargetsRelative ? (on.addVectors(this.boundingBox.min, rn.min), this.boundingBox.expandByPoint(on), on.addVectors(this.boundingBox.max, rn.max), this.boundingBox.expandByPoint(on)) : (this.boundingBox.expandByPoint(rn.min), this.boundingBox.expandByPoint(rn.max))
                    }
            } else this.boundingBox.makeEmpty();
            (isNaN(this.boundingBox.min.x) || isNaN(this.boundingBox.min.y) || isNaN(this.boundingBox.min.z)) && H('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.', this)
        }
        computeBoundingSphere() {
            null === this.boundingSphere && (this.boundingSphere = new Qe);
            const t = this.attributes.position,
                e = this.morphAttributes.position;
            if (t && t.isGLBufferAttribute) return H("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.", this), void this.boundingSphere.set(new rt, 1 / 0);
            if (t) {
                const n = this.boundingSphere.center;
                if (rn.setFromBufferAttribute(t), e)
                    for (let t = 0, a = e.length; t < a; t++) {
                        const n = e[t];
                        sn.setFromBufferAttribute(n), this.morphTargetsRelative ? (on.addVectors(rn.min, sn.min), rn.expandByPoint(on), on.addVectors(rn.max, sn.max), rn.expandByPoint(on)) : (rn.expandByPoint(sn.min), rn.expandByPoint(sn.max))
                    }
                rn.getCenter(n);
                let i = 0;
                for (let e = 0, a = t.count; e < a; e++) on.fromBufferAttribute(t, e), i = Math.max(i, n.distanceToSquared(on));
                if (e)
                    for (let a = 0, r = e.length; a < r; a++) {
                        const r = e[a],
                            s = this.morphTargetsRelative;
                        for (let e = 0, a = r.count; e < a; e++) on.fromBufferAttribute(r, e), s && (an.fromBufferAttribute(t, e), on.add(an)), i = Math.max(i, n.distanceToSquared(on))
                    }
                this.boundingSphere.radius = Math.sqrt(i), isNaN(this.boundingSphere.radius) && H('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.', this)
            }
        }
        computeTangents() {
            const t = this.index,
                e = this.attributes;
            if (null === t || void 0 === e.position || void 0 === e.normal || void 0 === e.uv) return void H("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");
            const n = e.position,
                i = e.normal,
                a = e.uv;
            !1 === this.hasAttribute("tangent") && this.setAttribute("tangent", new Ye(new Float32Array(4 * n.count), 4));
            const r = this.getAttribute("tangent"),
                s = [],
                o = [];
            for (let S = 0; S < n.count; S++) s[S] = new rt, o[S] = new rt;
            const l = new rt,
                c = new rt,
                h = new rt,
                u = new it,
                d = new it,
                p = new it,
                m = new rt,
                f = new rt;

            function g(t, e, i) {
                l.fromBufferAttribute(n, t), c.fromBufferAttribute(n, e), h.fromBufferAttribute(n, i), u.fromBufferAttribute(a, t), d.fromBufferAttribute(a, e), p.fromBufferAttribute(a, i), c.sub(l), h.sub(l), d.sub(u), p.sub(u);
                const r = 1 / (d.x * p.y - p.x * d.y);
                isFinite(r) && (m.copy(c).multiplyScalar(p.y).addScaledVector(h, -d.y).multiplyScalar(r), f.copy(h).multiplyScalar(d.x).addScaledVector(c, -p.x).multiplyScalar(r), s[t].add(m), s[e].add(m), s[i].add(m), o[t].add(f), o[e].add(f), o[i].add(f))
            }
            let _ = this.groups;
            0 === _.length && (_ = [{
                start: 0,
                count: t.count
            }]);
            for (let S = 0, E = _.length; S < E; ++S) {
                const e = _[S],
                    n = e.start;
                for (let i = n, a = n + e.count; i < a; i += 3) g(t.getX(i + 0), t.getX(i + 1), t.getX(i + 2))
            }
            const v = new rt,
                x = new rt,
                M = new rt,
                b = new rt;

            function y(t) {
                M.fromBufferAttribute(i, t), b.copy(M);
                const e = s[t];
                v.copy(e), v.sub(M.multiplyScalar(M.dot(e))).normalize(), x.crossVectors(b, e);
                const n = x.dot(o[t]) < 0 ? -1 : 1;
                r.setXYZW(t, v.x, v.y, v.z, n)
            }
            for (let S = 0, E = _.length; S < E; ++S) {
                const e = _[S],
                    n = e.start;
                for (let i = n, a = n + e.count; i < a; i += 3) y(t.getX(i + 0)), y(t.getX(i + 1)), y(t.getX(i + 2))
            }
        }
        computeVertexNormals() {
            const t = this.index,
                e = this.getAttribute("position");
            if (void 0 !== e) {
                let n = this.getAttribute("normal");
                if (void 0 === n) n = new Ye(new Float32Array(3 * e.count), 3), this.setAttribute("normal", n);
                else
                    for (let t = 0, e = n.count; t < e; t++) n.setXYZ(t, 0, 0, 0);
                const i = new rt,
                    a = new rt,
                    r = new rt,
                    s = new rt,
                    o = new rt,
                    l = new rt,
                    c = new rt,
                    h = new rt;
                if (t)
                    for (let u = 0, d = t.count; u < d; u += 3) {
                        const d = t.getX(u + 0),
                            p = t.getX(u + 1),
                            m = t.getX(u + 2);
                        i.fromBufferAttribute(e, d), a.fromBufferAttribute(e, p), r.fromBufferAttribute(e, m), c.subVectors(r, a), h.subVectors(i, a), c.cross(h), s.fromBufferAttribute(n, d), o.fromBufferAttribute(n, p), l.fromBufferAttribute(n, m), s.add(c), o.add(c), l.add(c), n.setXYZ(d, s.x, s.y, s.z), n.setXYZ(p, o.x, o.y, o.z), n.setXYZ(m, l.x, l.y, l.z)
                    } else
                        for (let t = 0, u = e.count; t < u; t += 3) i.fromBufferAttribute(e, t + 0), a.fromBufferAttribute(e, t + 1), r.fromBufferAttribute(e, t + 2), c.subVectors(r, a), h.subVectors(i, a), c.cross(h), n.setXYZ(t + 0, c.x, c.y, c.z), n.setXYZ(t + 1, c.x, c.y, c.z), n.setXYZ(t + 2, c.x, c.y, c.z);
                this.normalizeNormals(), n.needsUpdate = !0
            }
        }
        normalizeNormals() {
            const t = this.attributes.normal;
            for (let e = 0, n = t.count; e < n; e++) on.fromBufferAttribute(t, e), on.normalize(), t.setXYZ(e, on.x, on.y, on.z)
        }
        toNonIndexed() {
            function e(t, e) {
                const n = t.array,
                    i = t.itemSize,
                    a = t.normalized,
                    r = new n.constructor(e.length * i);
                let s = 0,
                    o = 0;
                for (let l = 0, c = e.length; l < c; l++) {
                    s = t.isInterleavedBufferAttribute ? e[l] * t.data.stride + t.offset : e[l] * i;
                    for (let t = 0; t < i; t++) r[o++] = n[s++]
                }
                return new Ye(r, i, a)
            }
            if (null === this.index) return k("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."), this;
            const n = new t,
                i = this.index.array,
                a = this.attributes;
            for (const t in a) {
                const r = e(a[t], i);
                n.setAttribute(t, r)
            }
            const r = this.morphAttributes;
            for (const t in r) {
                const a = [],
                    s = r[t];
                for (let t = 0, n = s.length; t < n; t++) {
                    const n = e(s[t], i);
                    a.push(n)
                }
                n.morphAttributes[t] = a
            }
            n.morphTargetsRelative = this.morphTargetsRelative;
            const s = this.groups;
            for (let t = 0, o = s.length; t < o; t++) {
                const e = s[t];
                n.addGroup(e.start, e.count, e.materialIndex)
            }
            return n
        }
        toJSON() {
            const t = {
                metadata: {
                    version: 4.7,
                    type: "BufferGeometry",
                    generator: "BufferGeometry.toJSON"
                }
            };
            if (t.uuid = this.uuid, t.type = this.type, "" !== this.name && (t.name = this.name), Object.keys(this.userData).length > 0 && (t.userData = this.userData), void 0 !== this.parameters) {
                const e = this.parameters;
                for (const n in e) void 0 !== e[n] && (t[n] = e[n]);
                return t
            }
            t.data = {
                attributes: {}
            };
            const e = this.index;
            null !== e && (t.data.index = {
                type: e.array.constructor.name,
                array: Array.prototype.slice.call(e.array)
            });
            const n = this.attributes;
            for (const o in n) {
                const e = n[o];
                t.data.attributes[o] = e.toJSON(t.data)
            }
            const i = {};
            let a = !1;
            for (const o in this.morphAttributes) {
                const e = this.morphAttributes[o],
                    n = [];
                for (let i = 0, a = e.length; i < a; i++) {
                    const a = e[i];
                    n.push(a.toJSON(t.data))
                }
                n.length > 0 && (i[o] = n, a = !0)
            }
            a && (t.data.morphAttributes = i, t.data.morphTargetsRelative = this.morphTargetsRelative);
            const r = this.groups;
            r.length > 0 && (t.data.groups = JSON.parse(JSON.stringify(r)));
            const s = this.boundingSphere;
            return null !== s && (t.data.boundingSphere = s.toJSON()), t
        }
        clone() {
            return (new this.constructor).copy(this)
        }
        copy(t) {
            this.index = null, this.attributes = {}, this.morphAttributes = {}, this.groups = [], this.boundingBox = null, this.boundingSphere = null;
            const e = {};
            this.name = t.name;
            const n = t.index;
            null !== n && this.setIndex(n.clone());
            const i = t.attributes;
            for (const l in i) {
                const t = i[l];
                this.setAttribute(l, t.clone(e))
            }
            const a = t.morphAttributes;
            for (const l in a) {
                const t = [],
                    n = a[l];
                for (let i = 0, a = n.length; i < a; i++) t.push(n[i].clone(e));
                this.morphAttributes[l] = t
            }
            this.morphTargetsRelative = t.morphTargetsRelative;
            const r = t.groups;
            for (let l = 0, c = r.length; l < c; l++) {
                const t = r[l];
                this.addGroup(t.start, t.count, t.materialIndex)
            }
            const s = t.boundingBox;
            null !== s && (this.boundingBox = s.clone());
            const o = t.boundingSphere;
            return null !== o && (this.boundingSphere = o.clone()), this.drawRange.start = t.drawRange.start, this.drawRange.count = t.drawRange.count, this.userData = t.userData, this
        }
        dispose() {
            this.dispatchEvent({
                type: "dispose"
            })
        }
    },
    cn = class {
        constructor(t, e) {
            this.isInterleavedBuffer = !0, this.array = t, this.stride = e, this.count = void 0 !== t ? t.length / e : 0, this.usage = 35044, this.updateRanges = [], this.version = 0, this.uuid = K()
        }
        onUploadCallback() {}
        set needsUpdate(t) {
            !0 === t && this.version++
        }
        setUsage(t) {
            return this.usage = t, this
        }
        addUpdateRange(t, e) {
            this.updateRanges.push({
                start: t,
                count: e
            })
        }
        clearUpdateRanges() {
            this.updateRanges.length = 0
        }
        copy(t) {
            return this.array = new t.array.constructor(t.array), this.count = t.count, this.stride = t.stride, this.usage = t.usage, this
        }
        copyAt(t, e, n) {
            t *= this.stride, n *= e.stride;
            for (let i = 0, a = this.stride; i < a; i++) this.array[t + i] = e.array[n + i];
            return this
        }
        set(t, e = 0) {
            return this.array.set(t, e), this
        }
        clone(t) {
            void 0 === t.arrayBuffers && (t.arrayBuffers = {}), void 0 === this.array.buffer._uuid && (this.array.buffer._uuid = K()), void 0 === t.arrayBuffers[this.array.buffer._uuid] && (t.arrayBuffers[this.array.buffer._uuid] = this.array.slice(0).buffer);
            const e = new this.array.constructor(t.arrayBuffers[this.array.buffer._uuid]),
                n = new this.constructor(e, this.stride);
            return n.setUsage(this.usage), n
        }
        onUpload(t) {
            return this.onUploadCallback = t, this
        }
        toJSON(t) {
            return void 0 === t.arrayBuffers && (t.arrayBuffers = {}), void 0 === this.array.buffer._uuid && (this.array.buffer._uuid = K()), void 0 === t.arrayBuffers[this.array.buffer._uuid] && (t.arrayBuffers[this.array.buffer._uuid] = Array.from(new Uint32Array(this.array.buffer))), {
                uuid: this.uuid,
                buffer: this.array.buffer._uuid,
                type: this.array.constructor.name,
                stride: this.stride
            }
        }
    },
    hn = new rt,
    un = class t {
        constructor(t, e, n, i = !1) {
            this.isInterleavedBufferAttribute = !0, this.name = "", this.data = t, this.itemSize = e, this.offset = n, this.normalized = i
        }
        get count() {
            return this.data.count
        }
        get array() {
            return this.data.array
        }
        set needsUpdate(t) {
            this.data.needsUpdate = t
        }
        applyMatrix4(t) {
            for (let e = 0, n = this.data.count; e < n; e++) hn.fromBufferAttribute(this, e), hn.applyMatrix4(t), this.setXYZ(e, hn.x, hn.y, hn.z);
            return this
        }
        applyNormalMatrix(t) {
            for (let e = 0, n = this.count; e < n; e++) hn.fromBufferAttribute(this, e), hn.applyNormalMatrix(t), this.setXYZ(e, hn.x, hn.y, hn.z);
            return this
        }
        transformDirection(t) {
            for (let e = 0, n = this.count; e < n; e++) hn.fromBufferAttribute(this, e), hn.transformDirection(t), this.setXYZ(e, hn.x, hn.y, hn.z);
            return this
        }
        getComponent(t, e) {
            let n = this.array[t * this.data.stride + this.offset + e];
            return this.normalized && (n = tt(n, this.array)), n
        }
        setComponent(t, e, n) {
            return this.normalized && (n = et(n, this.array)), this.data.array[t * this.data.stride + this.offset + e] = n, this
        }
        setX(t, e) {
            return this.normalized && (e = et(e, this.array)), this.data.array[t * this.data.stride + this.offset] = e, this
        }
        setY(t, e) {
            return this.normalized && (e = et(e, this.array)), this.data.array[t * this.data.stride + this.offset + 1] = e, this
        }
        setZ(t, e) {
            return this.normalized && (e = et(e, this.array)), this.data.array[t * this.data.stride + this.offset + 2] = e, this
        }
        setW(t, e) {
            return this.normalized && (e = et(e, this.array)), this.data.array[t * this.data.stride + this.offset + 3] = e, this
        }
        getX(t) {
            let e = this.data.array[t * this.data.stride + this.offset];
            return this.normalized && (e = tt(e, this.array)), e
        }
        getY(t) {
            let e = this.data.array[t * this.data.stride + this.offset + 1];
            return this.normalized && (e = tt(e, this.array)), e
        }
        getZ(t) {
            let e = this.data.array[t * this.data.stride + this.offset + 2];
            return this.normalized && (e = tt(e, this.array)), e
        }
        getW(t) {
            let e = this.data.array[t * this.data.stride + this.offset + 3];
            return this.normalized && (e = tt(e, this.array)), e
        }
        setXY(t, e, n) {
            return t = t * this.data.stride + this.offset, this.normalized && (e = et(e, this.array), n = et(n, this.array)), this.data.array[t + 0] = e, this.data.array[t + 1] = n, this
        }
        setXYZ(t, e, n, i) {
            return t = t * this.data.stride + this.offset, this.normalized && (e = et(e, this.array), n = et(n, this.array), i = et(i, this.array)), this.data.array[t + 0] = e, this.data.array[t + 1] = n, this.data.array[t + 2] = i, this
        }
        setXYZW(t, e, n, i, a) {
            return t = t * this.data.stride + this.offset, this.normalized && (e = et(e, this.array), n = et(n, this.array), i = et(i, this.array), a = et(a, this.array)), this.data.array[t + 0] = e, this.data.array[t + 1] = n, this.data.array[t + 2] = i, this.data.array[t + 3] = a, this
        }
        clone(e) {
            if (void 0 === e) {
                z("InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");
                const t = [];
                for (let e = 0; e < this.count; e++) {
                    const n = e * this.data.stride + this.offset;
                    for (let e = 0; e < this.itemSize; e++) t.push(this.data.array[n + e])
                }
                return new Ye(new this.array.constructor(t), this.itemSize, this.normalized)
            }
            return void 0 === e.interleavedBuffers && (e.interleavedBuffers = {}), void 0 === e.interleavedBuffers[this.data.uuid] && (e.interleavedBuffers[this.data.uuid] = this.data.clone(e)), new t(e.interleavedBuffers[this.data.uuid], this.itemSize, this.offset, this.normalized)
        }
        toJSON(t) {
            if (void 0 === t) {
                z("InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");
                const t = [];
                for (let e = 0; e < this.count; e++) {
                    const n = e * this.data.stride + this.offset;
                    for (let e = 0; e < this.itemSize; e++) t.push(this.data.array[n + e])
                }
                return {
                    itemSize: this.itemSize,
                    type: this.array.constructor.name,
                    array: t,
                    normalized: this.normalized
                }
            }
            return void 0 === t.interleavedBuffers && (t.interleavedBuffers = {}), void 0 === t.interleavedBuffers[this.data.uuid] && (t.interleavedBuffers[this.data.uuid] = this.data.toJSON(t)), {
                isInterleavedBufferAttribute: !0,
                itemSize: this.itemSize,
                data: this.data.uuid,
                offset: this.offset,
                normalized: this.normalized
            }
        }
    },
    dn = 0,
    pn = class extends X {
        constructor() {
            super(), this.isMaterial = !0, Object.defineProperty(this, "id", {
                value: dn++
            }), this.uuid = K(), this.name = "", this.type = "Material", this.blending = 1, this.side = 0, this.vertexColors = !1, this.opacity = 1, this.transparent = !1, this.alphaHash = !1, this.blendSrc = 204, this.blendDst = 205, this.blendEquation = 100, this.blendSrcAlpha = null, this.blendDstAlpha = null, this.blendEquationAlpha = null, this.blendColor = new he(0, 0, 0), this.blendAlpha = 0, this.depthFunc = 3, this.depthTest = !0, this.depthWrite = !0, this.stencilWriteMask = 255, this.stencilFunc = 519, this.stencilRef = 0, this.stencilFuncMask = 255, this.stencilFail = U, this.stencilZFail = U, this.stencilZPass = U, this.stencilWrite = !1, this.clippingPlanes = null, this.clipIntersection = !1, this.clipShadows = !1, this.shadowSide = null, this.colorWrite = !0, this.precision = null, this.polygonOffset = !1, this.polygonOffsetFactor = 0, this.polygonOffsetUnits = 0, this.dithering = !1, this.alphaToCoverage = !1, this.premultipliedAlpha = !1, this.forceSinglePass = !1, this.allowOverride = !0, this.visible = !0, this.toneMapped = !0, this.userData = {}, this.version = 0, this._alphaTest = 0
        }
        get alphaTest() {
            return this._alphaTest
        }
        set alphaTest(t) {
            this._alphaTest > 0 != t > 0 && this.version++, this._alphaTest = t
        }
        onBeforeRender() {}
        onBeforeCompile() {}
        customProgramCacheKey() {
            return this.onBeforeCompile.toString()
        }
        setValues(t) {
            if (void 0 !== t)
                for (const e in t) {
                    const n = t[e];
                    if (void 0 === n) {
                        k(`Material: parameter '${e}' has value of undefined.`);
                        continue
                    }
                    const i = this[e];
                    void 0 !== i ? i && i.isColor ? i.set(n) : i && i.isVector3 && n && n.isVector3 ? i.copy(n) : this[e] = n : k(`Material: '${e}' is not a property of THREE.${this.type}.`)
                }
        }
        toJSON(t) {
            const e = void 0 === t || "string" == typeof t;
            e && (t = {
                textures: {},
                images: {}
            });
            const n = {
                metadata: {
                    version: 4.7,
                    type: "Material",
                    generator: "Material.toJSON"
                }
            };

            function i(t) {
                const e = [];
                for (const n in t) {
                    const i = t[n];
                    delete i.metadata, e.push(i)
                }
                return e
            }
            if (n.uuid = this.uuid, n.type = this.type, "" !== this.name && (n.name = this.name), this.color && this.color.isColor && (n.color = this.color.getHex()), void 0 !== this.roughness && (n.roughness = this.roughness), void 0 !== this.metalness && (n.metalness = this.metalness), void 0 !== this.sheen && (n.sheen = this.sheen), this.sheenColor && this.sheenColor.isColor && (n.sheenColor = this.sheenColor.getHex()), void 0 !== this.sheenRoughness && (n.sheenRoughness = this.sheenRoughness), this.emissive && this.emissive.isColor && (n.emissive = this.emissive.getHex()), void 0 !== this.emissiveIntensity && 1 !== this.emissiveIntensity && (n.emissiveIntensity = this.emissiveIntensity), this.specular && this.specular.isColor && (n.specular = this.specular.getHex()), void 0 !== this.specularIntensity && (n.specularIntensity = this.specularIntensity), this.specularColor && this.specularColor.isColor && (n.specularColor = this.specularColor.getHex()), void 0 !== this.shininess && (n.shininess = this.shininess), void 0 !== this.clearcoat && (n.clearcoat = this.clearcoat), void 0 !== this.clearcoatRoughness && (n.clearcoatRoughness = this.clearcoatRoughness), this.clearcoatMap && this.clearcoatMap.isTexture && (n.clearcoatMap = this.clearcoatMap.toJSON(t).uuid), this.clearcoatRoughnessMap && this.clearcoatRoughnessMap.isTexture && (n.clearcoatRoughnessMap = this.clearcoatRoughnessMap.toJSON(t).uuid), this.clearcoatNormalMap && this.clearcoatNormalMap.isTexture && (n.clearcoatNormalMap = this.clearcoatNormalMap.toJSON(t).uuid, n.clearcoatNormalScale = this.clearcoatNormalScale.toArray()), this.sheenColorMap && this.sheenColorMap.isTexture && (n.sheenColorMap = this.sheenColorMap.toJSON(t).uuid), this.sheenRoughnessMap && this.sheenRoughnessMap.isTexture && (n.sheenRoughnessMap = this.sheenRoughnessMap.toJSON(t).uuid), void 0 !== this.dispersion && (n.dispersion = this.dispersion), void 0 !== this.iridescence && (n.iridescence = this.iridescence), void 0 !== this.iridescenceIOR && (n.iridescenceIOR = this.iridescenceIOR), void 0 !== this.iridescenceThicknessRange && (n.iridescenceThicknessRange = this.iridescenceThicknessRange), this.iridescenceMap && this.iridescenceMap.isTexture && (n.iridescenceMap = this.iridescenceMap.toJSON(t).uuid), this.iridescenceThicknessMap && this.iridescenceThicknessMap.isTexture && (n.iridescenceThicknessMap = this.iridescenceThicknessMap.toJSON(t).uuid), void 0 !== this.anisotropy && (n.anisotropy = this.anisotropy), void 0 !== this.anisotropyRotation && (n.anisotropyRotation = this.anisotropyRotation), this.anisotropyMap && this.anisotropyMap.isTexture && (n.anisotropyMap = this.anisotropyMap.toJSON(t).uuid), this.map && this.map.isTexture && (n.map = this.map.toJSON(t).uuid), this.matcap && this.matcap.isTexture && (n.matcap = this.matcap.toJSON(t).uuid), this.alphaMap && this.alphaMap.isTexture && (n.alphaMap = this.alphaMap.toJSON(t).uuid), this.lightMap && this.lightMap.isTexture && (n.lightMap = this.lightMap.toJSON(t).uuid, n.lightMapIntensity = this.lightMapIntensity), this.aoMap && this.aoMap.isTexture && (n.aoMap = this.aoMap.toJSON(t).uuid, n.aoMapIntensity = this.aoMapIntensity), this.bumpMap && this.bumpMap.isTexture && (n.bumpMap = this.bumpMap.toJSON(t).uuid, n.bumpScale = this.bumpScale), this.normalMap && this.normalMap.isTexture && (n.normalMap = this.normalMap.toJSON(t).uuid, n.normalMapType = this.normalMapType, n.normalScale = this.normalScale.toArray()), this.displacementMap && this.displacementMap.isTexture && (n.displacementMap = this.displacementMap.toJSON(t).uuid, n.displacementScale = this.displacementScale, n.displacementBias = this.displacementBias), this.roughnessMap && this.roughnessMap.isTexture && (n.roughnessMap = this.roughnessMap.toJSON(t).uuid), this.metalnessMap && this.metalnessMap.isTexture && (n.metalnessMap = this.metalnessMap.toJSON(t).uuid), this.emissiveMap && this.emissiveMap.isTexture && (n.emissiveMap = this.emissiveMap.toJSON(t).uuid), this.specularMap && this.specularMap.isTexture && (n.specularMap = this.specularMap.toJSON(t).uuid), this.specularIntensityMap && this.specularIntensityMap.isTexture && (n.specularIntensityMap = this.specularIntensityMap.toJSON(t).uuid), this.specularColorMap && this.specularColorMap.isTexture && (n.specularColorMap = this.specularColorMap.toJSON(t).uuid), this.envMap && this.envMap.isTexture && (n.envMap = this.envMap.toJSON(t).uuid, void 0 !== this.combine && (n.combine = this.combine)), void 0 !== this.envMapRotation && (n.envMapRotation = this.envMapRotation.toArray()), void 0 !== this.envMapIntensity && (n.envMapIntensity = this.envMapIntensity), void 0 !== this.reflectivity && (n.reflectivity = this.reflectivity), void 0 !== this.refractionRatio && (n.refractionRatio = this.refractionRatio), this.gradientMap && this.gradientMap.isTexture && (n.gradientMap = this.gradientMap.toJSON(t).uuid), void 0 !== this.transmission && (n.transmission = this.transmission), this.transmissionMap && this.transmissionMap.isTexture && (n.transmissionMap = this.transmissionMap.toJSON(t).uuid), void 0 !== this.thickness && (n.thickness = this.thickness), this.thicknessMap && this.thicknessMap.isTexture && (n.thicknessMap = this.thicknessMap.toJSON(t).uuid), void 0 !== this.attenuationDistance && this.attenuationDistance !== 1 / 0 && (n.attenuationDistance = this.attenuationDistance), void 0 !== this.attenuationColor && (n.attenuationColor = this.attenuationColor.getHex()), void 0 !== this.size && (n.size = this.size), null !== this.shadowSide && (n.shadowSide = this.shadowSide), void 0 !== this.sizeAttenuation && (n.sizeAttenuation = this.sizeAttenuation), 1 !== this.blending && (n.blending = this.blending), 0 !== this.side && (n.side = this.side), !0 === this.vertexColors && (n.vertexColors = !0), this.opacity < 1 && (n.opacity = this.opacity), !0 === this.transparent && (n.transparent = !0), 204 !== this.blendSrc && (n.blendSrc = this.blendSrc), 205 !== this.blendDst && (n.blendDst = this.blendDst), 100 !== this.blendEquation && (n.blendEquation = this.blendEquation), null !== this.blendSrcAlpha && (n.blendSrcAlpha = this.blendSrcAlpha), null !== this.blendDstAlpha && (n.blendDstAlpha = this.blendDstAlpha), null !== this.blendEquationAlpha && (n.blendEquationAlpha = this.blendEquationAlpha), this.blendColor && this.blendColor.isColor && (n.blendColor = this.blendColor.getHex()), 0 !== this.blendAlpha && (n.blendAlpha = this.blendAlpha), 3 !== this.depthFunc && (n.depthFunc = this.depthFunc), !1 === this.depthTest && (n.depthTest = this.depthTest), !1 === this.depthWrite && (n.depthWrite = this.depthWrite), !1 === this.colorWrite && (n.colorWrite = this.colorWrite), 255 !== this.stencilWriteMask && (n.stencilWriteMask = this.stencilWriteMask), 519 !== this.stencilFunc && (n.stencilFunc = this.stencilFunc), 0 !== this.stencilRef && (n.stencilRef = this.stencilRef), 255 !== this.stencilFuncMask && (n.stencilFuncMask = this.stencilFuncMask), 7680 !== this.stencilFail && (n.stencilFail = this.stencilFail), 7680 !== this.stencilZFail && (n.stencilZFail = this.stencilZFail), 7680 !== this.stencilZPass && (n.stencilZPass = this.stencilZPass), !0 === this.stencilWrite && (n.stencilWrite = this.stencilWrite), void 0 !== this.rotation && 0 !== this.rotation && (n.rotation = this.rotation), !0 === this.polygonOffset && (n.polygonOffset = !0), 0 !== this.polygonOffsetFactor && (n.polygonOffsetFactor = this.polygonOffsetFactor), 0 !== this.polygonOffsetUnits && (n.polygonOffsetUnits = this.polygonOffsetUnits), void 0 !== this.linewidth && 1 !== this.linewidth && (n.linewidth = this.linewidth), void 0 !== this.dashSize && (n.dashSize = this.dashSize), void 0 !== this.gapSize && (n.gapSize = this.gapSize), void 0 !== this.scale && (n.scale = this.scale), !0 === this.dithering && (n.dithering = !0), this.alphaTest > 0 && (n.alphaTest = this.alphaTest), !0 === this.alphaHash && (n.alphaHash = !0), !0 === this.alphaToCoverage && (n.alphaToCoverage = !0), !0 === this.premultipliedAlpha && (n.premultipliedAlpha = !0), !0 === this.forceSinglePass && (n.forceSinglePass = !0), !1 === this.allowOverride && (n.allowOverride = !1), !0 === this.wireframe && (n.wireframe = !0), this.wireframeLinewidth > 1 && (n.wireframeLinewidth = this.wireframeLinewidth), "round" !== this.wireframeLinecap && (n.wireframeLinecap = this.wireframeLinecap), "round" !== this.wireframeLinejoin && (n.wireframeLinejoin = this.wireframeLinejoin), !0 === this.flatShading && (n.flatShading = !0), !1 === this.visible && (n.visible = !1), !1 === this.toneMapped && (n.toneMapped = !1), !1 === this.fog && (n.fog = !1), Object.keys(this.userData).length > 0 && (n.userData = this.userData), e) {
                const e = i(t.textures),
                    a = i(t.images);
                e.length > 0 && (n.textures = e), a.length > 0 && (n.images = a)
            }
            return n
        }
        clone() {
            return (new this.constructor).copy(this)
        }
        copy(t) {
            this.name = t.name, this.blending = t.blending, this.side = t.side, this.vertexColors = t.vertexColors, this.opacity = t.opacity, this.transparent = t.transparent, this.blendSrc = t.blendSrc, this.blendDst = t.blendDst, this.blendEquation = t.blendEquation, this.blendSrcAlpha = t.blendSrcAlpha, this.blendDstAlpha = t.blendDstAlpha, this.blendEquationAlpha = t.blendEquationAlpha, this.blendColor.copy(t.blendColor), this.blendAlpha = t.blendAlpha, this.depthFunc = t.depthFunc, this.depthTest = t.depthTest, this.depthWrite = t.depthWrite, this.stencilWriteMask = t.stencilWriteMask, this.stencilFunc = t.stencilFunc, this.stencilRef = t.stencilRef, this.stencilFuncMask = t.stencilFuncMask, this.stencilFail = t.stencilFail, this.stencilZFail = t.stencilZFail, this.stencilZPass = t.stencilZPass, this.stencilWrite = t.stencilWrite;
            const e = t.clippingPlanes;
            let n = null;
            if (null !== e) {
                const t = e.length;
                n = new Array(t);
                for (let i = 0; i !== t; ++i) n[i] = e[i].clone()
            }
            return this.clippingPlanes = n, this.clipIntersection = t.clipIntersection, this.clipShadows = t.clipShadows, this.shadowSide = t.shadowSide, this.colorWrite = t.colorWrite, this.precision = t.precision, this.polygonOffset = t.polygonOffset, this.polygonOffsetFactor = t.polygonOffsetFactor, this.polygonOffsetUnits = t.polygonOffsetUnits, this.dithering = t.dithering, this.alphaTest = t.alphaTest, this.alphaHash = t.alphaHash, this.alphaToCoverage = t.alphaToCoverage, this.premultipliedAlpha = t.premultipliedAlpha, this.forceSinglePass = t.forceSinglePass, this.allowOverride = t.allowOverride, this.visible = t.visible, this.toneMapped = t.toneMapped, this.userData = JSON.parse(JSON.stringify(t.userData)), this
        }
        dispose() {
            this.dispatchEvent({
                type: "dispose"
            })
        }
        set needsUpdate(t) {
            !0 === t && this.version++
        }
    },
    mn = class extends pn {
        constructor(t) {
            super(), this.isSpriteMaterial = !0, this.type = "SpriteMaterial", this.color = new he(16777215), this.map = null, this.alphaMap = null, this.rotation = 0, this.sizeAttenuation = !0, this.transparent = !0, this.fog = !0, this.setValues(t)
        }
        copy(t) {
            return super.copy(t), this.color.copy(t.color), this.map = t.map, this.alphaMap = t.alphaMap, this.rotation = t.rotation, this.sizeAttenuation = t.sizeAttenuation, this.fog = t.fog, this
        }
    },
    fn = new rt,
    gn = new rt,
    _n = new rt,
    vn = new it,
    xn = new it,
    Mn = new Ct,
    bn = new rt,
    yn = new rt,
    Sn = new rt,
    En = new it,
    Tn = new it,
    wn = new it,
    An = class extends ne {
        constructor(t = new mn) {
            if (super(), this.isSprite = !0, this.type = "Sprite", void 0 === He) {
                He = new ln;
                const t = new cn(new Float32Array([-.5, -.5, 0, 0, 0, .5, -.5, 0, 1, 0, .5, .5, 0, 1, 1, -.5, .5, 0, 0, 1]), 5);
                He.setIndex([0, 1, 2, 0, 2, 3]), He.setAttribute("position", new un(t, 3, 0, !1)), He.setAttribute("uv", new un(t, 2, 3, !1))
            }
            this.geometry = He, this.material = t, this.center = new it(.5, .5), this.count = 1
        }
        raycast(t, e) {
            null === t.camera && H('Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'), gn.setFromMatrixScale(this.matrixWorld), Mn.copy(t.camera.matrixWorld), this.modelViewMatrix.multiplyMatrices(t.camera.matrixWorldInverse, this.matrixWorld), _n.setFromMatrixPosition(this.modelViewMatrix), t.camera.isPerspectiveCamera && !1 === this.material.sizeAttenuation && gn.multiplyScalar(-_n.z);
            const n = this.material.rotation;
            let i, a;
            0 !== n && (a = Math.cos(n), i = Math.sin(n));
            const r = this.center;
            Rn(bn.set(-.5, -.5, 0), _n, r, gn, i, a), Rn(yn.set(.5, -.5, 0), _n, r, gn, i, a), Rn(Sn.set(.5, .5, 0), _n, r, gn, i, a), En.set(0, 0), Tn.set(1, 0), wn.set(1, 1);
            let s = t.ray.intersectTriangle(bn, yn, Sn, !1, fn);
            if (null === s && (Rn(yn.set(-.5, .5, 0), _n, r, gn, i, a), Tn.set(0, 1), s = t.ray.intersectTriangle(bn, Sn, yn, !1, fn), null === s)) return;
            const o = t.ray.origin.distanceTo(fn);
            o < t.near || o > t.far || e.push({
                distance: o,
                point: fn.clone(),
                uv: we.getInterpolation(fn, bn, yn, Sn, En, Tn, wn, new it),
                face: null,
                object: this
            })
        }
        copy(t, e) {
            return super.copy(t, e), void 0 !== t.center && this.center.copy(t.center), this.material = t.material, this
        }
    };

function Rn(t, e, n, i, a, r) {
    vn.subVectors(t, n).addScalar(.5).multiply(i), void 0 !== a ? (xn.x = r * vn.x - a * vn.y, xn.y = a * vn.x + r * vn.y) : xn.copy(vn), t.copy(e), t.x += xn.x, t.y += xn.y, t.applyMatrix4(Mn)
}
var Cn = new rt,
    Pn = new rt,
    Dn = new rt,
    Ln = new rt,
    In = new rt,
    Un = new rt,
    Nn = new rt,
    On = class {
        constructor(t = new rt, e = new rt(0, 0, -1)) {
            this.origin = t, this.direction = e
        }
        set(t, e) {
            return this.origin.copy(t), this.direction.copy(e), this
        }
        copy(t) {
            return this.origin.copy(t.origin), this.direction.copy(t.direction), this
        }
        at(t, e) {
            return e.copy(this.origin).addScaledVector(this.direction, t)
        }
        lookAt(t) {
            return this.direction.copy(t).sub(this.origin).normalize(), this
        }
        recast(t) {
            return this.origin.copy(this.at(t, Cn)), this
        }
        closestPointToPoint(t, e) {
            e.subVectors(t, this.origin);
            const n = e.dot(this.direction);
            return n < 0 ? e.copy(this.origin) : e.copy(this.origin).addScaledVector(this.direction, n)
        }
        distanceToPoint(t) {
            return Math.sqrt(this.distanceSqToPoint(t))
        }
        distanceSqToPoint(t) {
            const e = Cn.subVectors(t, this.origin).dot(this.direction);
            return e < 0 ? this.origin.distanceToSquared(t) : (Cn.copy(this.origin).addScaledVector(this.direction, e), Cn.distanceToSquared(t))
        }
        distanceSqToSegment(t, e, n, i) {
            Pn.copy(t).add(e).multiplyScalar(.5), Dn.copy(e).sub(t).normalize(), Ln.copy(this.origin).sub(Pn);
            const a = .5 * t.distanceTo(e),
                r = -this.direction.dot(Dn),
                s = Ln.dot(this.direction),
                o = -Ln.dot(Dn),
                l = Ln.lengthSq(),
                c = Math.abs(1 - r * r);
            let h, u, d, p;
            if (c > 0)
                if (h = r * o - s, u = r * s - o, p = a * c, h >= 0)
                    if (u >= -p)
                        if (u <= p) {
                            const t = 1 / c;
                            h *= t, u *= t, d = h * (h + r * u + 2 * s) + u * (r * h + u + 2 * o) + l
                        } else u = a, h = Math.max(0, -(r * u + s)), d = -h * h + u * (u + 2 * o) + l;
            else u = -a, h = Math.max(0, -(r * u + s)), d = -h * h + u * (u + 2 * o) + l;
            else u <= -p ? (h = Math.max(0, -(-r * a + s)), u = h > 0 ? -a : Math.min(Math.max(-a, -o), a), d = -h * h + u * (u + 2 * o) + l) : u <= p ? (h = 0, u = Math.min(Math.max(-a, -o), a), d = u * (u + 2 * o) + l) : (h = Math.max(0, -(r * a + s)), u = h > 0 ? a : Math.min(Math.max(-a, -o), a), d = -h * h + u * (u + 2 * o) + l);
            else u = r > 0 ? -a : a, h = Math.max(0, -(r * u + s)), d = -h * h + u * (u + 2 * o) + l;
            return n && n.copy(this.origin).addScaledVector(this.direction, h), i && i.copy(Pn).addScaledVector(Dn, u), d
        }
        intersectSphere(t, e) {
            Cn.subVectors(t.center, this.origin);
            const n = Cn.dot(this.direction),
                i = Cn.dot(Cn) - n * n,
                a = t.radius * t.radius;
            if (i > a) return null;
            const r = Math.sqrt(a - i),
                s = n - r,
                o = n + r;
            return o < 0 ? null : s < 0 ? this.at(o, e) : this.at(s, e)
        }
        intersectsSphere(t) {
            return !(t.radius < 0) && this.distanceSqToPoint(t.center) <= t.radius * t.radius
        }
        distanceToPlane(t) {
            const e = t.normal.dot(this.direction);
            if (0 === e) return 0 === t.distanceToPoint(this.origin) ? 0 : null;
            const n = -(this.origin.dot(t.normal) + t.constant) / e;
            return n >= 0 ? n : null
        }
        intersectPlane(t, e) {
            const n = this.distanceToPlane(t);
            return null === n ? null : this.at(n, e)
        }
        intersectsPlane(t) {
            const e = t.distanceToPoint(this.origin);
            return 0 === e || t.normal.dot(this.direction) * e < 0
        }
        intersectBox(t, e) {
            let n, i, a, r, s, o;
            const l = 1 / this.direction.x,
                c = 1 / this.direction.y,
                h = 1 / this.direction.z,
                u = this.origin;
            return l >= 0 ? (n = (t.min.x - u.x) * l, i = (t.max.x - u.x) * l) : (n = (t.max.x - u.x) * l, i = (t.min.x - u.x) * l), c >= 0 ? (a = (t.min.y - u.y) * c, r = (t.max.y - u.y) * c) : (a = (t.max.y - u.y) * c, r = (t.min.y - u.y) * c), n > r || a > i ? null : ((a > n || isNaN(n)) && (n = a), (r < i || isNaN(i)) && (i = r), h >= 0 ? (s = (t.min.z - u.z) * h, o = (t.max.z - u.z) * h) : (s = (t.max.z - u.z) * h, o = (t.min.z - u.z) * h), n > o || s > i ? null : ((s > n || n != n) && (n = s), (o < i || i != i) && (i = o), i < 0 ? null : this.at(n >= 0 ? n : i, e)))
        }
        intersectsBox(t) {
            return null !== this.intersectBox(t, Cn)
        }
        intersectTriangle(t, e, n, i, a) {
            In.subVectors(e, t), Un.subVectors(n, t), Nn.crossVectors(In, Un);
            let r, s = this.direction.dot(Nn);
            if (s > 0) {
                if (i) return null;
                r = 1
            } else {
                if (!(s < 0)) return null;
                r = -1, s = -s
            }
            Ln.subVectors(this.origin, t);
            const o = r * this.direction.dot(Un.crossVectors(Ln, Un));
            if (o < 0) return null;
            const l = r * this.direction.dot(In.cross(Ln));
            if (l < 0) return null;
            if (o + l > s) return null;
            const c = -r * Ln.dot(Nn);
            return c < 0 ? null : this.at(c / s, a)
        }
        applyMatrix4(t) {
            return this.origin.applyMatrix4(t), this.direction.transformDirection(t), this
        }
        equals(t) {
            return t.origin.equals(this.origin) && t.direction.equals(this.direction)
        }
        clone() {
            return (new this.constructor).copy(this)
        }
    },
    Fn = class extends pn {
        constructor(t) {
            super(), this.isMeshBasicMaterial = !0, this.type = "MeshBasicMaterial", this.color = new he(16777215), this.map = null, this.lightMap = null, this.lightMapIntensity = 1, this.aoMap = null, this.aoMapIntensity = 1, this.specularMap = null, this.alphaMap = null, this.envMap = null, this.envMapRotation = new zt, this.combine = 0, this.reflectivity = 1, this.refractionRatio = .98, this.wireframe = !1, this.wireframeLinewidth = 1, this.wireframeLinecap = "round", this.wireframeLinejoin = "round", this.fog = !0, this.setValues(t)
        }
        copy(t) {
            return super.copy(t), this.color.copy(t.color), this.map = t.map, this.lightMap = t.lightMap, this.lightMapIntensity = t.lightMapIntensity, this.aoMap = t.aoMap, this.aoMapIntensity = t.aoMapIntensity, this.specularMap = t.specularMap, this.alphaMap = t.alphaMap, this.envMap = t.envMap, this.envMapRotation.copy(t.envMapRotation), this.combine = t.combine, this.reflectivity = t.reflectivity, this.refractionRatio = t.refractionRatio, this.wireframe = t.wireframe, this.wireframeLinewidth = t.wireframeLinewidth, this.wireframeLinecap = t.wireframeLinecap, this.wireframeLinejoin = t.wireframeLinejoin, this.fog = t.fog, this
        }
    },
    Bn = new Ct,
    zn = new On,
    Vn = new Qe,
    kn = new rt,
    Hn = new rt,
    Gn = new rt,
    Wn = new rt,
    Xn = new rt,
    Yn = new rt,
    jn = new rt,
    qn = new rt,
    Zn = class extends ne {
        constructor(t = new ln, e = new Fn) {
            super(), this.isMesh = !0, this.type = "Mesh", this.geometry = t, this.material = e, this.morphTargetDictionary = void 0, this.morphTargetInfluences = void 0, this.count = 1, this.updateMorphTargets()
        }
        copy(t, e) {
            return super.copy(t, e), void 0 !== t.morphTargetInfluences && (this.morphTargetInfluences = t.morphTargetInfluences.slice()), void 0 !== t.morphTargetDictionary && (this.morphTargetDictionary = Object.assign({}, t.morphTargetDictionary)), this.material = Array.isArray(t.material) ? t.material.slice() : t.material, this.geometry = t.geometry, this
        }
        updateMorphTargets() {
            const t = this.geometry.morphAttributes,
                e = Object.keys(t);
            if (e.length > 0) {
                const n = t[e[0]];
                if (void 0 !== n) {
                    this.morphTargetInfluences = [], this.morphTargetDictionary = {};
                    for (let t = 0, e = n.length; t < e; t++) {
                        const e = n[t].name || String(t);
                        this.morphTargetInfluences.push(0), this.morphTargetDictionary[e] = t
                    }
                }
            }
        }
        getVertexPosition(t, e) {
            const n = this.geometry,
                i = n.attributes.position,
                a = n.morphAttributes.position,
                r = n.morphTargetsRelative;
            e.fromBufferAttribute(i, t);
            const s = this.morphTargetInfluences;
            if (a && s) {
                Yn.set(0, 0, 0);
                for (let n = 0, i = a.length; n < i; n++) {
                    const i = s[n],
                        o = a[n];
                    0 !== i && (Xn.fromBufferAttribute(o, t), r ? Yn.addScaledVector(Xn, i) : Yn.addScaledVector(Xn.sub(e), i))
                }
                e.add(Yn)
            }
            return e
        }
        raycast(t, e) {
            const n = this.geometry,
                i = this.material,
                a = this.matrixWorld;
            if (void 0 !== i) {
                if (null === n.boundingSphere && n.computeBoundingSphere(), Vn.copy(n.boundingSphere), Vn.applyMatrix4(a), zn.copy(t.ray).recast(t.near), !1 === Vn.containsPoint(zn.origin)) {
                    if (null === zn.intersectSphere(Vn, kn)) return;
                    if (zn.origin.distanceToSquared(kn) > (t.far - t.near) ** 2) return
                }
                Bn.copy(a).invert(), zn.copy(t.ray).applyMatrix4(Bn), null !== n.boundingBox && !1 === zn.intersectsBox(n.boundingBox) || this._computeIntersections(t, e, zn)
            }
        }
        _computeIntersections(t, e, n) {
            let i;
            const a = this.geometry,
                r = this.material,
                s = a.index,
                o = a.attributes.position,
                l = a.attributes.uv,
                c = a.attributes.uv1,
                h = a.attributes.normal,
                u = a.groups,
                d = a.drawRange;
            if (null !== s)
                if (Array.isArray(r))
                    for (let p = 0, m = u.length; p < m; p++) {
                        const a = u[p],
                            o = r[a.materialIndex];
                        for (let r = Math.max(a.start, d.start), u = Math.min(s.count, Math.min(a.start + a.count, d.start + d.count)); r < u; r += 3) {
                            i = Kn(this, o, t, n, l, c, h, s.getX(r), s.getX(r + 1), s.getX(r + 2)), i && (i.faceIndex = Math.floor(r / 3), i.face.materialIndex = a.materialIndex, e.push(i))
                        }
                    } else {
                        for (let a = Math.max(0, d.start), o = Math.min(s.count, d.start + d.count); a < o; a += 3) {
                            i = Kn(this, r, t, n, l, c, h, s.getX(a), s.getX(a + 1), s.getX(a + 2)), i && (i.faceIndex = Math.floor(a / 3), e.push(i))
                        }
                    } else if (void 0 !== o)
                        if (Array.isArray(r))
                            for (let p = 0, m = u.length; p < m; p++) {
                                const a = u[p],
                                    s = r[a.materialIndex];
                                for (let r = Math.max(a.start, d.start), u = Math.min(o.count, Math.min(a.start + a.count, d.start + d.count)); r < u; r += 3) {
                                    i = Kn(this, s, t, n, l, c, h, r, r + 1, r + 2), i && (i.faceIndex = Math.floor(r / 3), i.face.materialIndex = a.materialIndex, e.push(i))
                                }
                            } else {
                                for (let a = Math.max(0, d.start), s = Math.min(o.count, d.start + d.count); a < s; a += 3) {
                                    i = Kn(this, r, t, n, l, c, h, a, a + 1, a + 2), i && (i.faceIndex = Math.floor(a / 3), e.push(i))
                                }
                            }
        }
    };

function Kn(t, e, n, i, a, r, s, o, l, c) {
    t.getVertexPosition(o, Hn), t.getVertexPosition(l, Gn), t.getVertexPosition(c, Wn);
    const h = function(t, e, n, i, a, r, s, o) {
        let l;
        if (l = 1 === e.side ? i.intersectTriangle(s, r, a, !0, o) : i.intersectTriangle(a, r, s, 0 === e.side, o), null === l) return null;
        qn.copy(o), qn.applyMatrix4(t.matrixWorld);
        const c = n.ray.origin.distanceTo(qn);
        return c < n.near || c > n.far ? null : {
            distance: c,
            point: qn.clone(),
            object: t
        }
    }(t, e, n, i, Hn, Gn, Wn, jn);
    if (h) {
        const t = new rt;
        we.getBarycoord(jn, Hn, Gn, Wn, t), a && (h.uv = we.getInterpolatedAttribute(a, o, l, c, t, new it)), r && (h.uv1 = we.getInterpolatedAttribute(r, o, l, c, t, new it)), s && (h.normal = we.getInterpolatedAttribute(s, o, l, c, t, new rt), h.normal.dot(i.direction) > 0 && h.normal.multiplyScalar(-1));
        const e = {
            a: o,
            b: l,
            c: c,
            normal: new rt,
            materialIndex: 0
        };
        we.getNormal(Hn, Gn, Wn, e.normal), h.face = e, h.barycoord = t
    }
    return h
}
var Jn = class extends St {
        constructor(t = null, e = 1, n = 1, i, a, r, s, o, l = 1003, c = 1003, h, u) {
            super(null, r, s, o, l, c, i, a, h, u), this.isDataTexture = !0, this.image = {
                data: t,
                width: e,
                height: n
            }, this.generateMipmaps = !1, this.flipY = !1, this.unpackAlignment = 1
        }
    },
    $n = new rt,
    Qn = new rt,
    ti = new lt,
    ei = class {
        constructor(t = new rt(1, 0, 0), e = 0) {
            this.isPlane = !0, this.normal = t, this.constant = e
        }
        set(t, e) {
            return this.normal.copy(t), this.constant = e, this
        }
        setComponents(t, e, n, i) {
            return this.normal.set(t, e, n), this.constant = i, this
        }
        setFromNormalAndCoplanarPoint(t, e) {
            return this.normal.copy(t), this.constant = -e.dot(this.normal), this
        }
        setFromCoplanarPoints(t, e, n) {
            const i = $n.subVectors(n, e).cross(Qn.subVectors(t, e)).normalize();
            return this.setFromNormalAndCoplanarPoint(i, t), this
        }
        copy(t) {
            return this.normal.copy(t.normal), this.constant = t.constant, this
        }
        normalize() {
            const t = 1 / this.normal.length();
            return this.normal.multiplyScalar(t), this.constant *= t, this
        }
        negate() {
            return this.constant *= -1, this.normal.negate(), this
        }
        distanceToPoint(t) {
            return this.normal.dot(t) + this.constant
        }
        distanceToSphere(t) {
            return this.distanceToPoint(t.center) - t.radius
        }
        projectPoint(t, e) {
            return e.copy(t).addScaledVector(this.normal, -this.distanceToPoint(t))
        }
        intersectLine(t, e) {
            const n = t.delta($n),
                i = this.normal.dot(n);
            if (0 === i) return 0 === this.distanceToPoint(t.start) ? e.copy(t.start) : null;
            const a = -(t.start.dot(this.normal) + this.constant) / i;
            return a < 0 || a > 1 ? null : e.copy(t.start).addScaledVector(n, a)
        }
        intersectsLine(t) {
            const e = this.distanceToPoint(t.start),
                n = this.distanceToPoint(t.end);
            return e < 0 && n > 0 || n < 0 && e > 0
        }
        intersectsBox(t) {
            return t.intersectsPlane(this)
        }
        intersectsSphere(t) {
            return t.intersectsPlane(this)
        }
        coplanarPoint(t) {
            return t.copy(this.normal).multiplyScalar(-this.constant)
        }
        applyMatrix4(t, e) {
            const n = e || ti.getNormalMatrix(t),
                i = this.coplanarPoint($n).applyMatrix4(t),
                a = this.normal.applyMatrix3(n).normalize();
            return this.constant = -i.dot(a), this
        }
        translate(t) {
            return this.constant -= t.dot(this.normal), this
        }
        equals(t) {
            return t.normal.equals(this.normal) && t.constant === this.constant
        }
        clone() {
            return (new this.constructor).copy(this)
        }
    },
    ni = new Qe,
    ii = new it(.5, .5),
    ai = new rt,
    ri = class {
        constructor(t = new ei, e = new ei, n = new ei, i = new ei, a = new ei, r = new ei) {
            this.planes = [t, e, n, i, a, r]
        }
        set(t, e, n, i, a, r) {
            const s = this.planes;
            return s[0].copy(t), s[1].copy(e), s[2].copy(n), s[3].copy(i), s[4].copy(a), s[5].copy(r), this
        }
        copy(t) {
            const e = this.planes;
            for (let n = 0; n < 6; n++) e[n].copy(t.planes[n]);
            return this
        }
        setFromProjectionMatrix(t, e = 2e3, n = !1) {
            const i = this.planes,
                a = t.elements,
                r = a[0],
                s = a[1],
                o = a[2],
                l = a[3],
                c = a[4],
                h = a[5],
                u = a[6],
                d = a[7],
                p = a[8],
                m = a[9],
                f = a[10],
                g = a[11],
                _ = a[12],
                v = a[13],
                x = a[14],
                M = a[15];
            if (i[0].setComponents(l - r, d - c, g - p, M - _).normalize(), i[1].setComponents(l + r, d + c, g + p, M + _).normalize(), i[2].setComponents(l + s, d + h, g + m, M + v).normalize(), i[3].setComponents(l - s, d - h, g - m, M - v).normalize(), n) i[4].setComponents(o, u, f, x).normalize(), i[5].setComponents(l - o, d - u, g - f, M - x).normalize();
            else if (i[4].setComponents(l - o, d - u, g - f, M - x).normalize(), 2e3 === e) i[5].setComponents(l + o, d + u, g + f, M + x).normalize();
            else {
                if (2001 !== e) throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: " + e);
                i[5].setComponents(o, u, f, x).normalize()
            }
            return this
        }
        intersectsObject(t) {
            if (void 0 !== t.boundingSphere) null === t.boundingSphere && t.computeBoundingSphere(), ni.copy(t.boundingSphere).applyMatrix4(t.matrixWorld);
            else {
                const e = t.geometry;
                null === e.boundingSphere && e.computeBoundingSphere(), ni.copy(e.boundingSphere).applyMatrix4(t.matrixWorld)
            }
            return this.intersectsSphere(ni)
        }
        intersectsSprite(t) {
            return ni.center.set(0, 0, 0), ni.radius = .7071067811865476 + ii.distanceTo(t.center), ni.applyMatrix4(t.matrixWorld), this.intersectsSphere(ni)
        }
        intersectsSphere(t) {
            const e = this.planes,
                n = t.center,
                i = -t.radius;
            for (let a = 0; a < 6; a++)
                if (e[a].distanceToPoint(n) < i) return !1;
            return !0
        }
        intersectsBox(t) {
            const e = this.planes;
            for (let n = 0; n < 6; n++) {
                const i = e[n];
                if (ai.x = i.normal.x > 0 ? t.max.x : t.min.x, ai.y = i.normal.y > 0 ? t.max.y : t.min.y, ai.z = i.normal.z > 0 ? t.max.z : t.min.z, i.distanceToPoint(ai) < 0) return !1
            }
            return !0
        }
        containsPoint(t) {
            const e = this.planes;
            for (let n = 0; n < 6; n++)
                if (e[n].distanceToPoint(t) < 0) return !1;
            return !0
        }
        clone() {
            return (new this.constructor).copy(this)
        }
    },
    si = class extends St {
        constructor(t = [], e = 301, n, i, a, r, s, o, l, c) {
            super(t, e, n, i, a, r, s, o, l, c), this.isCubeTexture = !0, this.flipY = !1
        }
        get images() {
            return this.image
        }
        set images(t) {
            this.image = t
        }
    },
    oi = class extends St {
        constructor(t, e, n, i, a, r, s, o, l) {
            super(t, e, n, i, a, r, s, o, l), this.isCanvasTexture = !0, this.needsUpdate = !0
        }
    },
    li = class extends St {
        constructor(t, e, n = 1014, i, a, r, s = 1003, o = 1003, l, c = 1026, h = 1) {
            if (1026 !== c && 1027 !== c) throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");
            super({
                width: t,
                height: e,
                depth: h
            }, i, a, r, s, o, c, n, l), this.isDepthTexture = !0, this.flipY = !1, this.generateMipmaps = !1, this.compareFunction = null
        }
        copy(t) {
            return super.copy(t), this.source = new xt(Object.assign({}, t.image)), this.compareFunction = t.compareFunction, this
        }
        toJSON(t) {
            const e = super.toJSON(t);
            return null !== this.compareFunction && (e.compareFunction = this.compareFunction), e
        }
    },
    ci = class extends li {
        constructor(t, e = 1014, n = 301, i, a, r = 1003, s = 1003, o, l = 1026) {
            const c = {
                    width: t,
                    height: t,
                    depth: 1
                },
                h = [c, c, c, c, c, c];
            super(t, t, e, n, i, a, r, s, o, l), this.image = h, this.isCubeDepthTexture = !0, this.isCubeTexture = !0
        }
        get images() {
            return this.image
        }
        set images(t) {
            this.image = t
        }
    },
    hi = class extends St {
        constructor(t = null) {
            super(), this.sourceTexture = t, this.isExternalTexture = !0
        }
        copy(t) {
            return super.copy(t), this.sourceTexture = t.sourceTexture, this
        }
    },
    ui = class t extends ln {
        constructor(t = 1, e = 1, n = 1, i = 1, a = 1, r = 1) {
            super(), this.type = "BoxGeometry", this.parameters = {
                width: t,
                height: e,
                depth: n,
                widthSegments: i,
                heightSegments: a,
                depthSegments: r
            };
            const s = this;
            i = Math.floor(i), a = Math.floor(a), r = Math.floor(r);
            const o = [],
                l = [],
                c = [],
                h = [];
            let u = 0,
                d = 0;

            function p(t, e, n, i, a, r, p, m, f, g, _) {
                const v = r / f,
                    x = p / g,
                    M = r / 2,
                    b = p / 2,
                    y = m / 2,
                    S = f + 1,
                    E = g + 1;
                let T = 0,
                    w = 0;
                const A = new rt;
                for (let s = 0; s < E; s++) {
                    const r = s * x - b;
                    for (let o = 0; o < S; o++) A[t] = (o * v - M) * i, A[e] = r * a, A[n] = y, l.push(A.x, A.y, A.z), A[t] = 0, A[e] = 0, A[n] = m > 0 ? 1 : -1, c.push(A.x, A.y, A.z), h.push(o / f), h.push(1 - s / g), T += 1
                }
                for (let s = 0; s < g; s++)
                    for (let t = 0; t < f; t++) {
                        const e = u + t + S * s,
                            n = u + t + S * (s + 1),
                            i = u + (t + 1) + S * (s + 1),
                            a = u + (t + 1) + S * s;
                        o.push(e, n, a), o.push(n, i, a), w += 6
                    }
                s.addGroup(d, w, _), d += w, u += T
            }
            p("z", "y", "x", -1, -1, n, e, t, r, a, 0), p("z", "y", "x", 1, -1, n, e, -t, r, a, 1), p("x", "z", "y", 1, 1, t, n, e, i, r, 2), p("x", "z", "y", 1, -1, t, n, -e, i, r, 3), p("x", "y", "z", 1, -1, t, e, n, i, a, 4), p("x", "y", "z", -1, -1, t, e, -n, i, a, 5), this.setIndex(o), this.setAttribute("position", new Ze(l, 3)), this.setAttribute("normal", new Ze(c, 3)), this.setAttribute("uv", new Ze(h, 2))
        }
        copy(t) {
            return super.copy(t), this.parameters = Object.assign({}, t.parameters), this
        }
        static fromJSON(e) {
            return new t(e.width, e.height, e.depth, e.widthSegments, e.heightSegments, e.depthSegments)
        }
    },
    di = class t extends ln {
        constructor(t = 1, e = 1, n = 1, i = 1) {
            super(), this.type = "PlaneGeometry", this.parameters = {
                width: t,
                height: e,
                widthSegments: n,
                heightSegments: i
            };
            const a = t / 2,
                r = e / 2,
                s = Math.floor(n),
                o = Math.floor(i),
                l = s + 1,
                c = o + 1,
                h = t / s,
                u = e / o,
                d = [],
                p = [],
                m = [],
                f = [];
            for (let g = 0; g < c; g++) {
                const t = g * u - r;
                for (let e = 0; e < l; e++) {
                    const n = e * h - a;
                    p.push(n, -t, 0), m.push(0, 0, 1), f.push(e / s), f.push(1 - g / o)
                }
            }
            for (let g = 0; g < o; g++)
                for (let t = 0; t < s; t++) {
                    const e = t + l * g,
                        n = t + l * (g + 1),
                        i = t + 1 + l * (g + 1),
                        a = t + 1 + l * g;
                    d.push(e, n, a), d.push(n, i, a)
                }
            this.setIndex(d), this.setAttribute("position", new Ze(p, 3)), this.setAttribute("normal", new Ze(m, 3)), this.setAttribute("uv", new Ze(f, 2))
        }
        copy(t) {
            return super.copy(t), this.parameters = Object.assign({}, t.parameters), this
        }
        static fromJSON(e) {
            return new t(e.width, e.height, e.widthSegments, e.heightSegments)
        }
    };

function pi(t) {
    const e = {};
    for (const n in t) {
        e[n] = {};
        for (const i in t[n]) {
            const a = t[n][i];
            a && (a.isColor || a.isMatrix3 || a.isMatrix4 || a.isVector2 || a.isVector3 || a.isVector4 || a.isTexture || a.isQuaternion) ? a.isRenderTargetTexture ? (k("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."), e[n][i] = null) : e[n][i] = a.clone() : Array.isArray(a) ? e[n][i] = a.slice() : e[n][i] = a
        }
    }
    return e
}

function mi(t) {
    const e = {};
    for (let n = 0; n < t.length; n++) {
        const i = pi(t[n]);
        for (const t in i) e[t] = i[t]
    }
    return e
}

function fi(t) {
    const e = t.getRenderTarget();
    return null === e ? t.outputColorSpace : !0 === e.isXRRenderTarget ? e.texture.colorSpace : mt.workingColorSpace
}
var gi = {
        clone: pi,
        merge: mi
    },
    _i = class extends pn {
        constructor(t) {
            super(), this.isShaderMaterial = !0, this.type = "ShaderMaterial", this.defines = {}, this.uniforms = {}, this.uniformsGroups = [], this.vertexShader = "void main() {\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}", this.fragmentShader = "void main() {\n\tgl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n}", this.linewidth = 1, this.wireframe = !1, this.wireframeLinewidth = 1, this.fog = !1, this.lights = !1, this.clipping = !1, this.forceSinglePass = !0, this.extensions = {
                clipCullDistance: !1,
                multiDraw: !1
            }, this.defaultAttributeValues = {
                color: [1, 1, 1],
                uv: [0, 0],
                uv1: [0, 0]
            }, this.index0AttributeName = void 0, this.uniformsNeedUpdate = !1, this.glslVersion = null, void 0 !== t && this.setValues(t)
        }
        copy(t) {
            return super.copy(t), this.fragmentShader = t.fragmentShader, this.vertexShader = t.vertexShader, this.uniforms = pi(t.uniforms), this.uniformsGroups = function(t) {
                const e = [];
                for (let n = 0; n < t.length; n++) e.push(t[n].clone());
                return e
            }(t.uniformsGroups), this.defines = Object.assign({}, t.defines), this.wireframe = t.wireframe, this.wireframeLinewidth = t.wireframeLinewidth, this.fog = t.fog, this.lights = t.lights, this.clipping = t.clipping, this.extensions = Object.assign({}, t.extensions), this.glslVersion = t.glslVersion, this.defaultAttributeValues = Object.assign({}, t.defaultAttributeValues), this.index0AttributeName = t.index0AttributeName, this.uniformsNeedUpdate = t.uniformsNeedUpdate, this
        }
        toJSON(t) {
            const e = super.toJSON(t);
            e.glslVersion = this.glslVersion, e.uniforms = {};
            for (const i in this.uniforms) {
                const n = this.uniforms[i].value;
                n && n.isTexture ? e.uniforms[i] = {
                    type: "t",
                    value: n.toJSON(t).uuid
                } : n && n.isColor ? e.uniforms[i] = {
                    type: "c",
                    value: n.getHex()
                } : n && n.isVector2 ? e.uniforms[i] = {
                    type: "v2",
                    value: n.toArray()
                } : n && n.isVector3 ? e.uniforms[i] = {
                    type: "v3",
                    value: n.toArray()
                } : n && n.isVector4 ? e.uniforms[i] = {
                    type: "v4",
                    value: n.toArray()
                } : n && n.isMatrix3 ? e.uniforms[i] = {
                    type: "m3",
                    value: n.toArray()
                } : n && n.isMatrix4 ? e.uniforms[i] = {
                    type: "m4",
                    value: n.toArray()
                } : e.uniforms[i] = {
                    value: n
                }
            }
            Object.keys(this.defines).length > 0 && (e.defines = this.defines), e.vertexShader = this.vertexShader, e.fragmentShader = this.fragmentShader, e.lights = this.lights, e.clipping = this.clipping;
            const n = {};
            for (const i in this.extensions) !0 === this.extensions[i] && (n[i] = !0);
            return Object.keys(n).length > 0 && (e.extensions = n), e
        }
    },
    vi = class extends _i {
        constructor(t) {
            super(t), this.isRawShaderMaterial = !0, this.type = "RawShaderMaterial"
        }
    },
    xi = class extends pn {
        constructor(t) {
            super(), this.isMeshStandardMaterial = !0, this.type = "MeshStandardMaterial", this.defines = {
                STANDARD: ""
            }, this.color = new he(16777215), this.roughness = 1, this.metalness = 0, this.map = null, this.lightMap = null, this.lightMapIntensity = 1, this.aoMap = null, this.aoMapIntensity = 1, this.emissive = new he(0), this.emissiveIntensity = 1, this.emissiveMap = null, this.bumpMap = null, this.bumpScale = 1, this.normalMap = null, this.normalMapType = 0, this.normalScale = new it(1, 1), this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.roughnessMap = null, this.metalnessMap = null, this.alphaMap = null, this.envMap = null, this.envMapRotation = new zt, this.envMapIntensity = 1, this.wireframe = !1, this.wireframeLinewidth = 1, this.wireframeLinecap = "round", this.wireframeLinejoin = "round", this.flatShading = !1, this.fog = !0, this.setValues(t)
        }
        copy(t) {
            return super.copy(t), this.defines = {
                STANDARD: ""
            }, this.color.copy(t.color), this.roughness = t.roughness, this.metalness = t.metalness, this.map = t.map, this.lightMap = t.lightMap, this.lightMapIntensity = t.lightMapIntensity, this.aoMap = t.aoMap, this.aoMapIntensity = t.aoMapIntensity, this.emissive.copy(t.emissive), this.emissiveMap = t.emissiveMap, this.emissiveIntensity = t.emissiveIntensity, this.bumpMap = t.bumpMap, this.bumpScale = t.bumpScale, this.normalMap = t.normalMap, this.normalMapType = t.normalMapType, this.normalScale.copy(t.normalScale), this.displacementMap = t.displacementMap, this.displacementScale = t.displacementScale, this.displacementBias = t.displacementBias, this.roughnessMap = t.roughnessMap, this.metalnessMap = t.metalnessMap, this.alphaMap = t.alphaMap, this.envMap = t.envMap, this.envMapRotation.copy(t.envMapRotation), this.envMapIntensity = t.envMapIntensity, this.wireframe = t.wireframe, this.wireframeLinewidth = t.wireframeLinewidth, this.wireframeLinecap = t.wireframeLinecap, this.wireframeLinejoin = t.wireframeLinejoin, this.flatShading = t.flatShading, this.fog = t.fog, this
        }
    },
    Mi = class extends pn {
        constructor(t) {
            super(), this.isMeshDepthMaterial = !0, this.type = "MeshDepthMaterial", this.depthPacking = 3200, this.map = null, this.alphaMap = null, this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.wireframe = !1, this.wireframeLinewidth = 1, this.setValues(t)
        }
        copy(t) {
            return super.copy(t), this.depthPacking = t.depthPacking, this.map = t.map, this.alphaMap = t.alphaMap, this.displacementMap = t.displacementMap, this.displacementScale = t.displacementScale, this.displacementBias = t.displacementBias, this.wireframe = t.wireframe, this.wireframeLinewidth = t.wireframeLinewidth, this
        }
    },
    bi = class extends pn {
        constructor(t) {
            super(), this.isMeshDistanceMaterial = !0, this.type = "MeshDistanceMaterial", this.map = null, this.alphaMap = null, this.displacementMap = null, this.displacementScale = 1, this.displacementBias = 0, this.setValues(t)
        }
        copy(t) {
            return super.copy(t), this.map = t.map, this.alphaMap = t.alphaMap, this.displacementMap = t.displacementMap, this.displacementScale = t.displacementScale, this.displacementBias = t.displacementBias, this
        }
    };

function yi(t, e) {
    return t && t.constructor !== e ? "number" == typeof e.BYTES_PER_ELEMENT ? new e(t) : Array.prototype.slice.call(t) : t
}
var Si = class {
        constructor(t, e, n, i) {
            this.parameterPositions = t, this._cachedIndex = 0, this.resultBuffer = void 0 !== i ? i : new e.constructor(n), this.sampleValues = e, this.valueSize = n, this.settings = null, this.DefaultSettings_ = {}
        }
        evaluate(t) {
            const e = this.parameterPositions;
            let n = this._cachedIndex,
                i = e[n],
                a = e[n - 1];
            t: {
                e: {
                    let r;n: {
                        i: if (!(t < i)) {
                            for (let r = n + 2;;) {
                                if (void 0 === i) {
                                    if (t < a) break i;
                                    return n = e.length, this._cachedIndex = n, this.copySampleValue_(n - 1)
                                }
                                if (n === r) break;
                                if (a = i, i = e[++n], t < i) break e
                            }
                            r = e.length;
                            break n
                        }if (!(t >= a)) {
                            const s = e[1];
                            t < s && (n = 2, a = s);
                            for (let r = n - 2;;) {
                                if (void 0 === a) return this._cachedIndex = 0, this.copySampleValue_(0);
                                if (n === r) break;
                                if (i = a, a = e[--n - 1], t >= a) break e
                            }
                            r = n, n = 0;
                            break n
                        }
                        break t
                    }
                    for (; n < r;) {
                        const i = n + r >>> 1;
                        t < e[i] ? r = i : n = i + 1
                    }
                    if (i = e[n], a = e[n - 1], void 0 === a) return this._cachedIndex = 0,
                    this.copySampleValue_(0);
                    if (void 0 === i) return n = e.length,
                    this._cachedIndex = n,
                    this.copySampleValue_(n - 1)
                }
                this._cachedIndex = n,
                this.intervalChanged_(n, a, i)
            }
            return this.interpolate_(n, a, t, i)
        }
        getSettings_() {
            return this.settings || this.DefaultSettings_
        }
        copySampleValue_(t) {
            const e = this.resultBuffer,
                n = this.sampleValues,
                i = this.valueSize,
                a = t * i;
            for (let r = 0; r !== i; ++r) e[r] = n[a + r];
            return e
        }
        interpolate_() {
            throw new Error("call to abstract method")
        }
        intervalChanged_() {}
    },
    Ei = class extends Si {
        constructor(t, e, n, i) {
            super(t, e, n, i), this._weightPrev = -0, this._offsetPrev = -0, this._weightNext = -0, this._offsetNext = -0, this.DefaultSettings_ = {
                endingStart: 2400,
                endingEnd: 2400
            }
        }
        intervalChanged_(t, e, n) {
            const i = this.parameterPositions;
            let a = t - 2,
                r = t + 1,
                s = i[a],
                o = i[r];
            if (void 0 === s) switch (this.getSettings_().endingStart) {
                case 2401:
                    a = t, s = 2 * e - n;
                    break;
                case 2402:
                    a = i.length - 2, s = e + i[a] - i[a + 1];
                    break;
                default:
                    a = t, s = n
            }
            if (void 0 === o) switch (this.getSettings_().endingEnd) {
                case 2401:
                    r = t, o = 2 * n - e;
                    break;
                case 2402:
                    r = 1, o = n + i[1] - i[0];
                    break;
                default:
                    r = t - 1, o = e
            }
            const l = .5 * (n - e),
                c = this.valueSize;
            this._weightPrev = l / (e - s), this._weightNext = l / (o - n), this._offsetPrev = a * c, this._offsetNext = r * c
        }
        interpolate_(t, e, n, i) {
            const a = this.resultBuffer,
                r = this.sampleValues,
                s = this.valueSize,
                o = t * s,
                l = o - s,
                c = this._offsetPrev,
                h = this._offsetNext,
                u = this._weightPrev,
                d = this._weightNext,
                p = (n - e) / (i - e),
                m = p * p,
                f = m * p,
                g = -u * f + 2 * u * m - u * p,
                _ = (1 + u) * f + (-1.5 - 2 * u) * m + (-.5 + u) * p + 1,
                v = (-1 - d) * f + (1.5 + d) * m + .5 * p,
                x = d * f - d * m;
            for (let M = 0; M !== s; ++M) a[M] = g * r[c + M] + _ * r[l + M] + v * r[o + M] + x * r[h + M];
            return a
        }
    },
    Ti = class extends Si {
        constructor(t, e, n, i) {
            super(t, e, n, i)
        }
        interpolate_(t, e, n, i) {
            const a = this.resultBuffer,
                r = this.sampleValues,
                s = this.valueSize,
                o = t * s,
                l = o - s,
                c = (n - e) / (i - e),
                h = 1 - c;
            for (let u = 0; u !== s; ++u) a[u] = r[l + u] * h + r[o + u] * c;
            return a
        }
    },
    wi = class extends Si {
        constructor(t, e, n, i) {
            super(t, e, n, i)
        }
        interpolate_(t) {
            return this.copySampleValue_(t - 1)
        }
    },
    Ai = class extends Si {
        interpolate_(t, e, n, i) {
            const a = this.resultBuffer,
                r = this.sampleValues,
                s = this.valueSize,
                o = t * s,
                l = o - s,
                c = this.settings || this.DefaultSettings_,
                h = c.inTangents,
                u = c.outTangents;
            if (!h || !u) {
                const t = (n - e) / (i - e),
                    c = 1 - t;
                for (let e = 0; e !== s; ++e) a[e] = r[l + e] * c + r[o + e] * t;
                return a
            }
            const d = 2 * s,
                p = t - 1;
            for (let m = 0; m !== s; ++m) {
                const s = r[l + m],
                    c = r[o + m],
                    f = p * d + 2 * m,
                    g = u[f],
                    _ = u[f + 1],
                    v = t * d + 2 * m,
                    x = h[v],
                    M = h[v + 1];
                let b, y, S, E, T, w = (n - e) / (i - e);
                for (let t = 0; t < 8; t++) {
                    b = w * w, y = b * w, S = 1 - w, E = S * S, T = E * S;
                    const t = T * e + 3 * E * w * g + 3 * S * b * x + y * i - n;
                    if (Math.abs(t) < 1e-10) break;
                    const a = 3 * E * (g - e) + 6 * S * w * (x - g) + 3 * b * (i - x);
                    if (Math.abs(a) < 1e-10) break;
                    w -= t / a, w = Math.max(0, Math.min(1, w))
                }
                a[m] = T * s + 3 * E * w * _ + 3 * S * b * M + y * c
            }
            return a
        }
    },
    Ri = class {
        constructor(t, e, n, i) {
            if (void 0 === t) throw new Error("THREE.KeyframeTrack: track name is undefined");
            if (void 0 === e || 0 === e.length) throw new Error("THREE.KeyframeTrack: no keyframes in track named " + t);
            this.name = t, this.times = yi(e, this.TimeBufferType), this.values = yi(n, this.ValueBufferType), this.setInterpolation(i || this.DefaultInterpolation)
        }
        static toJSON(t) {
            const e = t.constructor;
            let n;
            if (e.toJSON !== this.toJSON) n = e.toJSON(t);
            else {
                n = {
                    name: t.name,
                    times: yi(t.times, Array),
                    values: yi(t.values, Array)
                };
                const e = t.getInterpolation();
                e !== t.DefaultInterpolation && (n.interpolation = e)
            }
            return n.type = t.ValueTypeName, n
        }
        InterpolantFactoryMethodDiscrete(t) {
            return new wi(this.times, this.values, this.getValueSize(), t)
        }
        InterpolantFactoryMethodLinear(t) {
            return new Ti(this.times, this.values, this.getValueSize(), t)
        }
        InterpolantFactoryMethodSmooth(t) {
            return new Ei(this.times, this.values, this.getValueSize(), t)
        }
        InterpolantFactoryMethodBezier(t) {
            const e = new Ai(this.times, this.values, this.getValueSize(), t);
            return this.settings && (e.settings = this.settings), e
        }
        setInterpolation(t) {
            let e;
            switch (t) {
                case A:
                    e = this.InterpolantFactoryMethodDiscrete;
                    break;
                case R:
                    e = this.InterpolantFactoryMethodLinear;
                    break;
                case C:
                    e = this.InterpolantFactoryMethodSmooth;
                    break;
                case 2303:
                    e = this.InterpolantFactoryMethodBezier
            }
            if (void 0 === e) {
                const e = "unsupported interpolation for " + this.ValueTypeName + " keyframe track named " + this.name;
                if (void 0 === this.createInterpolant) {
                    if (t === this.DefaultInterpolation) throw new Error(e);
                    this.setInterpolation(this.DefaultInterpolation)
                }
                return k("KeyframeTrack:", e), this
            }
            return this.createInterpolant = e, this
        }
        getInterpolation() {
            switch (this.createInterpolant) {
                case this.InterpolantFactoryMethodDiscrete:
                    return A;
                case this.InterpolantFactoryMethodLinear:
                    return R;
                case this.InterpolantFactoryMethodSmooth:
                    return C;
                case this.InterpolantFactoryMethodBezier:
                    return 2303
            }
        }
        getValueSize() {
            return this.values.length / this.times.length
        }
        shift(t) {
            if (0 !== t) {
                const e = this.times;
                for (let n = 0, i = e.length; n !== i; ++n) e[n] += t
            }
            return this
        }
        scale(t) {
            if (1 !== t) {
                const e = this.times;
                for (let n = 0, i = e.length; n !== i; ++n) e[n] *= t
            }
            return this
        }
        trim(t, e) {
            const n = this.times,
                i = n.length;
            let a = 0,
                r = i - 1;
            for (; a !== i && n[a] < t;) ++a;
            for (; - 1 !== r && n[r] > e;) --r;
            if (++r, 0 !== a || r !== i) {
                a >= r && (r = Math.max(r, 1), a = r - 1);
                const t = this.getValueSize();
                this.times = n.slice(a, r), this.values = this.values.slice(a * t, r * t)
            }
            return this
        }
        validate() {
            let t = !0;
            const e = this.getValueSize();
            e - Math.floor(e) !== 0 && (H("KeyframeTrack: Invalid value size in track.", this), t = !1);
            const n = this.times,
                i = this.values,
                a = n.length;
            0 === a && (H("KeyframeTrack: Track is empty.", this), t = !1);
            let r = null;
            for (let o = 0; o !== a; o++) {
                const e = n[o];
                if ("number" == typeof e && isNaN(e)) {
                    H("KeyframeTrack: Time is not a valid number.", this, o, e), t = !1;
                    break
                }
                if (null !== r && r > e) {
                    H("KeyframeTrack: Out of order keys.", this, o, e, r), t = !1;
                    break
                }
                r = e
            }
            if (void 0 !== i && (s = i, ArrayBuffer.isView(s) && !(s instanceof DataView)))
                for (let o = 0, l = i.length; o !== l; ++o) {
                    const e = i[o];
                    if (isNaN(e)) {
                        H("KeyframeTrack: Value is not a valid number.", this, o, e), t = !1;
                        break
                    }
                }
            var s;
            return t
        }
        optimize() {
            const t = this.times.slice(),
                e = this.values.slice(),
                n = this.getValueSize(),
                i = this.getInterpolation() === C,
                a = t.length - 1;
            let r = 1;
            for (let s = 1; s < a; ++s) {
                let a = !1;
                const o = t[s];
                if (o !== t[s + 1] && (1 !== s || o !== t[0]))
                    if (i) a = !0;
                    else {
                        const t = s * n,
                            i = t - n,
                            r = t + n;
                        for (let s = 0; s !== n; ++s) {
                            const n = e[t + s];
                            if (n !== e[i + s] || n !== e[r + s]) {
                                a = !0;
                                break
                            }
                        }
                    } if (a) {
                    if (s !== r) {
                        t[r] = t[s];
                        const i = s * n,
                            a = r * n;
                        for (let t = 0; t !== n; ++t) e[a + t] = e[i + t]
                    }++r
                }
            }
            if (a > 0) {
                t[r] = t[a];
                for (let t = a * n, i = r * n, s = 0; s !== n; ++s) e[i + s] = e[t + s];
                ++r
            }
            return r !== t.length ? (this.times = t.slice(0, r), this.values = e.slice(0, r * n)) : (this.times = t, this.values = e), this
        }
        clone() {
            const t = this.times.slice(),
                e = this.values.slice(),
                n = new(0, this.constructor)(this.name, t, e);
            return n.createInterpolant = this.createInterpolant, n
        }
    };
Ri.prototype.ValueTypeName = "", Ri.prototype.TimeBufferType = Float32Array, Ri.prototype.ValueBufferType = Float32Array, Ri.prototype.DefaultInterpolation = R;
var Ci = class extends Ri {
    constructor(t, e, n) {
        super(t, e, n)
    }
};
Ci.prototype.ValueTypeName = "bool", Ci.prototype.ValueBufferType = Array, Ci.prototype.DefaultInterpolation = A, Ci.prototype.InterpolantFactoryMethodLinear = void 0, Ci.prototype.InterpolantFactoryMethodSmooth = void 0;
(class extends Ri {
    constructor(t, e, n, i) {
        super(t, e, n, i)
    }
}).prototype.ValueTypeName = "color";
(class extends Ri {
    constructor(t, e, n, i) {
        super(t, e, n, i)
    }
}).prototype.ValueTypeName = "number";
var Pi = class extends Si {
        constructor(t, e, n, i) {
            super(t, e, n, i)
        }
        interpolate_(t, e, n, i) {
            const a = this.resultBuffer,
                r = this.sampleValues,
                s = this.valueSize,
                o = (n - e) / (i - e);
            let l = t * s;
            for (let c = l + s; l !== c; l += 4) at.slerpFlat(a, 0, r, l - s, r, l, o);
            return a
        }
    },
    Di = class extends Ri {
        constructor(t, e, n, i) {
            super(t, e, n, i)
        }
        InterpolantFactoryMethodLinear(t) {
            return new Pi(this.times, this.values, this.getValueSize(), t)
        }
    };
Di.prototype.ValueTypeName = "quaternion", Di.prototype.InterpolantFactoryMethodSmooth = void 0;
var Li = class extends Ri {
    constructor(t, e, n) {
        super(t, e, n)
    }
};
Li.prototype.ValueTypeName = "string", Li.prototype.ValueBufferType = Array, Li.prototype.DefaultInterpolation = A, Li.prototype.InterpolantFactoryMethodLinear = void 0, Li.prototype.InterpolantFactoryMethodSmooth = void 0;
(class extends Ri {
    constructor(t, e, n, i) {
        super(t, e, n, i)
    }
}).prototype.ValueTypeName = "vector";
var Ii = class extends ne {
        constructor(t, e = 1) {
            super(), this.isLight = !0, this.type = "Light", this.color = new he(t), this.intensity = e
        }
        dispose() {
            this.dispatchEvent({
                type: "dispose"
            })
        }
        copy(t, e) {
            return super.copy(t, e), this.color.copy(t.color), this.intensity = t.intensity, this
        }
        toJSON(t) {
            const e = super.toJSON(t);
            return e.object.color = this.color.getHex(), e.object.intensity = this.intensity, e
        }
    },
    Ui = new Ct,
    Ni = new rt,
    Oi = new rt,
    Fi = class {
        constructor(t) {
            this.camera = t, this.intensity = 1, this.bias = 0, this.biasNode = null, this.normalBias = 0, this.radius = 1, this.blurSamples = 8, this.mapSize = new it(512, 512), this.mapType = _, this.map = null, this.mapPass = null, this.matrix = new Ct, this.autoUpdate = !0, this.needsUpdate = !1, this._frustum = new ri, this._frameExtents = new it(1, 1), this._viewportCount = 1, this._viewports = [new Et(0, 0, 1, 1)]
        }
        getViewportCount() {
            return this._viewportCount
        }
        getFrustum() {
            return this._frustum
        }
        updateMatrices(t) {
            const e = this.camera,
                n = this.matrix;
            Ni.setFromMatrixPosition(t.matrixWorld), e.position.copy(Ni), Oi.setFromMatrixPosition(t.target.matrixWorld), e.lookAt(Oi), e.updateMatrixWorld(), Ui.multiplyMatrices(e.projectionMatrix, e.matrixWorldInverse), this._frustum.setFromProjectionMatrix(Ui, e.coordinateSystem, e.reversedDepth), 2001 === e.coordinateSystem || e.reversedDepth ? n.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, 1, 0, 0, 0, 0, 1) : n.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1), n.multiply(Ui)
        }
        getViewport(t) {
            return this._viewports[t]
        }
        getFrameExtents() {
            return this._frameExtents
        }
        dispose() {
            this.map && this.map.dispose(), this.mapPass && this.mapPass.dispose()
        }
        copy(t) {
            return this.camera = t.camera.clone(), this.intensity = t.intensity, this.bias = t.bias, this.radius = t.radius, this.autoUpdate = t.autoUpdate, this.needsUpdate = t.needsUpdate, this.normalBias = t.normalBias, this.blurSamples = t.blurSamples, this.mapSize.copy(t.mapSize), this.biasNode = t.biasNode, this
        }
        clone() {
            return (new this.constructor).copy(this)
        }
        toJSON() {
            const t = {};
            return 1 !== this.intensity && (t.intensity = this.intensity), 0 !== this.bias && (t.bias = this.bias), 0 !== this.normalBias && (t.normalBias = this.normalBias), 1 !== this.radius && (t.radius = this.radius), 512 === this.mapSize.x && 512 === this.mapSize.y || (t.mapSize = this.mapSize.toArray()), t.camera = this.camera.toJSON(!1).object, delete t.camera.matrix, t
        }
    },
    Bi = new rt,
    zi = new at,
    Vi = new rt,
    ki = class extends ne {
        constructor() {
            super(), this.isCamera = !0, this.type = "Camera", this.matrixWorldInverse = new Ct, this.projectionMatrix = new Ct, this.projectionMatrixInverse = new Ct, this.coordinateSystem = N, this._reversedDepth = !1
        }
        get reversedDepth() {
            return this._reversedDepth
        }
        copy(t, e) {
            return super.copy(t, e), this.matrixWorldInverse.copy(t.matrixWorldInverse), this.projectionMatrix.copy(t.projectionMatrix), this.projectionMatrixInverse.copy(t.projectionMatrixInverse), this.coordinateSystem = t.coordinateSystem, this
        }
        getWorldDirection(t) {
            return super.getWorldDirection(t).negate()
        }
        updateMatrixWorld(t) {
            super.updateMatrixWorld(t), this.matrixWorld.decompose(Bi, zi, Vi), 1 === Vi.x && 1 === Vi.y && 1 === Vi.z ? this.matrixWorldInverse.copy(this.matrixWorld).invert() : this.matrixWorldInverse.compose(Bi, zi, Vi.set(1, 1, 1)).invert()
        }
        updateWorldMatrix(t, e) {
            super.updateWorldMatrix(t, e), this.matrixWorld.decompose(Bi, zi, Vi), 1 === Vi.x && 1 === Vi.y && 1 === Vi.z ? this.matrixWorldInverse.copy(this.matrixWorld).invert() : this.matrixWorldInverse.compose(Bi, zi, Vi.set(1, 1, 1)).invert()
        }
        clone() {
            return (new this.constructor).copy(this)
        }
    },
    Hi = new rt,
    Gi = new it,
    Wi = new it,
    Xi = class extends ki {
        constructor(t = 50, e = 1, n = .1, i = 2e3) {
            super(), this.isPerspectiveCamera = !0, this.type = "PerspectiveCamera", this.fov = t, this.zoom = 1, this.near = n, this.far = i, this.focus = 10, this.aspect = e, this.view = null, this.filmGauge = 35, this.filmOffset = 0, this.updateProjectionMatrix()
        }
        copy(t, e) {
            return super.copy(t, e), this.fov = t.fov, this.zoom = t.zoom, this.near = t.near, this.far = t.far, this.focus = t.focus, this.aspect = t.aspect, this.view = null === t.view ? null : Object.assign({}, t.view), this.filmGauge = t.filmGauge, this.filmOffset = t.filmOffset, this
        }
        setFocalLength(t) {
            const e = .5 * this.getFilmHeight() / t;
            this.fov = 2 * Z * Math.atan(e), this.updateProjectionMatrix()
        }
        getFocalLength() {
            const t = Math.tan(.5 * q * this.fov);
            return .5 * this.getFilmHeight() / t
        }
        getEffectiveFOV() {
            return 2 * Z * Math.atan(Math.tan(.5 * q * this.fov) / this.zoom)
        }
        getFilmWidth() {
            return this.filmGauge * Math.min(this.aspect, 1)
        }
        getFilmHeight() {
            return this.filmGauge / Math.max(this.aspect, 1)
        }
        getViewBounds(t, e, n) {
            Hi.set(-1, -1, .5).applyMatrix4(this.projectionMatrixInverse), e.set(Hi.x, Hi.y).multiplyScalar(-t / Hi.z), Hi.set(1, 1, .5).applyMatrix4(this.projectionMatrixInverse), n.set(Hi.x, Hi.y).multiplyScalar(-t / Hi.z)
        }
        getViewSize(t, e) {
            return this.getViewBounds(t, Gi, Wi), e.subVectors(Wi, Gi)
        }
        setViewOffset(t, e, n, i, a, r) {
            this.aspect = t / e, null === this.view && (this.view = {
                enabled: !0,
                fullWidth: 1,
                fullHeight: 1,
                offsetX: 0,
                offsetY: 0,
                width: 1,
                height: 1
            }), this.view.enabled = !0, this.view.fullWidth = t, this.view.fullHeight = e, this.view.offsetX = n, this.view.offsetY = i, this.view.width = a, this.view.height = r, this.updateProjectionMatrix()
        }
        clearViewOffset() {
            null !== this.view && (this.view.enabled = !1), this.updateProjectionMatrix()
        }
        updateProjectionMatrix() {
            const t = this.near;
            let e = t * Math.tan(.5 * q * this.fov) / this.zoom,
                n = 2 * e,
                i = this.aspect * n,
                a = -.5 * i;
            const r = this.view;
            if (null !== this.view && this.view.enabled) {
                const t = r.fullWidth,
                    s = r.fullHeight;
                a += r.offsetX * i / t, e -= r.offsetY * n / s, i *= r.width / t, n *= r.height / s
            }
            const s = this.filmOffset;
            0 !== s && (a += t * s / this.getFilmWidth()), this.projectionMatrix.makePerspective(a, a + i, e, e - n, t, this.far, this.coordinateSystem, this.reversedDepth), this.projectionMatrixInverse.copy(this.projectionMatrix).invert()
        }
        toJSON(t) {
            const e = super.toJSON(t);
            return e.object.fov = this.fov, e.object.zoom = this.zoom, e.object.near = this.near, e.object.far = this.far, e.object.focus = this.focus, e.object.aspect = this.aspect, null !== this.view && (e.object.view = Object.assign({}, this.view)), e.object.filmGauge = this.filmGauge, e.object.filmOffset = this.filmOffset, e
        }
    },
    Yi = class extends ki {
        constructor(t = -1, e = 1, n = 1, i = -1, a = .1, r = 2e3) {
            super(), this.isOrthographicCamera = !0, this.type = "OrthographicCamera", this.zoom = 1, this.view = null, this.left = t, this.right = e, this.top = n, this.bottom = i, this.near = a, this.far = r, this.updateProjectionMatrix()
        }
        copy(t, e) {
            return super.copy(t, e), this.left = t.left, this.right = t.right, this.top = t.top, this.bottom = t.bottom, this.near = t.near, this.far = t.far, this.zoom = t.zoom, this.view = null === t.view ? null : Object.assign({}, t.view), this
        }
        setViewOffset(t, e, n, i, a, r) {
            null === this.view && (this.view = {
                enabled: !0,
                fullWidth: 1,
                fullHeight: 1,
                offsetX: 0,
                offsetY: 0,
                width: 1,
                height: 1
            }), this.view.enabled = !0, this.view.fullWidth = t, this.view.fullHeight = e, this.view.offsetX = n, this.view.offsetY = i, this.view.width = a, this.view.height = r, this.updateProjectionMatrix()
        }
        clearViewOffset() {
            null !== this.view && (this.view.enabled = !1), this.updateProjectionMatrix()
        }
        updateProjectionMatrix() {
            const t = (this.right - this.left) / (2 * this.zoom),
                e = (this.top - this.bottom) / (2 * this.zoom),
                n = (this.right + this.left) / 2,
                i = (this.top + this.bottom) / 2;
            let a = n - t,
                r = n + t,
                s = i + e,
                o = i - e;
            if (null !== this.view && this.view.enabled) {
                const t = (this.right - this.left) / this.view.fullWidth / this.zoom,
                    e = (this.top - this.bottom) / this.view.fullHeight / this.zoom;
                a += t * this.view.offsetX, r = a + t * this.view.width, s -= e * this.view.offsetY, o = s - e * this.view.height
            }
            this.projectionMatrix.makeOrthographic(a, r, s, o, this.near, this.far, this.coordinateSystem, this.reversedDepth), this.projectionMatrixInverse.copy(this.projectionMatrix).invert()
        }
        toJSON(t) {
            const e = super.toJSON(t);
            return e.object.zoom = this.zoom, e.object.left = this.left, e.object.right = this.right, e.object.top = this.top, e.object.bottom = this.bottom, e.object.near = this.near, e.object.far = this.far, null !== this.view && (e.object.view = Object.assign({}, this.view)), e
        }
    },
    ji = class extends Fi {
        constructor() {
            super(new Yi(-5, 5, 5, -5, .5, 500)), this.isDirectionalLightShadow = !0
        }
    },
    qi = class extends Ii {
        constructor(t, e) {
            super(t, e), this.isDirectionalLight = !0, this.type = "DirectionalLight", this.position.copy(ne.DEFAULT_UP), this.updateMatrix(), this.target = new ne, this.shadow = new ji
        }
        dispose() {
            super.dispose(), this.shadow.dispose()
        }
        copy(t) {
            return super.copy(t), this.target = t.target.clone(), this.shadow = t.shadow.clone(), this
        }
        toJSON(t) {
            const e = super.toJSON(t);
            return e.object.shadow = this.shadow.toJSON(), e.object.target = this.target.uuid, e
        }
    },
    Zi = class extends Ii {
        constructor(t, e) {
            super(t, e), this.isAmbientLight = !0, this.type = "AmbientLight"
        }
    },
    Ki = -90,
    Ji = class extends ne {
        constructor(t, e, n) {
            super(), this.type = "CubeCamera", this.renderTarget = n, this.coordinateSystem = null, this.activeMipmapLevel = 0;
            const i = new Xi(Ki, 1, t, e);
            i.layers = this.layers, this.add(i);
            const a = new Xi(Ki, 1, t, e);
            a.layers = this.layers, this.add(a);
            const r = new Xi(Ki, 1, t, e);
            r.layers = this.layers, this.add(r);
            const s = new Xi(Ki, 1, t, e);
            s.layers = this.layers, this.add(s);
            const o = new Xi(Ki, 1, t, e);
            o.layers = this.layers, this.add(o);
            const l = new Xi(Ki, 1, t, e);
            l.layers = this.layers, this.add(l)
        }
        updateCoordinateSystem() {
            const t = this.coordinateSystem,
                e = this.children.concat(),
                [n, i, a, r, s, o] = e;
            for (const l of e) this.remove(l);
            if (2e3 === t) n.up.set(0, 1, 0), n.lookAt(1, 0, 0), i.up.set(0, 1, 0), i.lookAt(-1, 0, 0), a.up.set(0, 0, -1), a.lookAt(0, 1, 0), r.up.set(0, 0, 1), r.lookAt(0, -1, 0), s.up.set(0, 1, 0), s.lookAt(0, 0, 1), o.up.set(0, 1, 0), o.lookAt(0, 0, -1);
            else {
                if (2001 !== t) throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: " + t);
                n.up.set(0, -1, 0), n.lookAt(-1, 0, 0), i.up.set(0, -1, 0), i.lookAt(1, 0, 0), a.up.set(0, 0, 1), a.lookAt(0, 1, 0), r.up.set(0, 0, -1), r.lookAt(0, -1, 0), s.up.set(0, -1, 0), s.lookAt(0, 0, 1), o.up.set(0, -1, 0), o.lookAt(0, 0, -1)
            }
            for (const l of e) this.add(l), l.updateMatrixWorld()
        }
        update(t, e) {
            null === this.parent && this.updateMatrixWorld();
            const {
                renderTarget: n,
                activeMipmapLevel: i
            } = this;
            this.coordinateSystem !== t.coordinateSystem && (this.coordinateSystem = t.coordinateSystem, this.updateCoordinateSystem());
            const [a, r, s, o, l, c] = this.children, h = t.getRenderTarget(), u = t.getActiveCubeFace(), d = t.getActiveMipmapLevel(), p = t.xr.enabled;
            t.xr.enabled = !1;
            const m = n.texture.generateMipmaps;
            n.texture.generateMipmaps = !1;
            let f = !1;
            f = !0 === t.isWebGLRenderer ? t.state.buffers.depth.getReversed() : t.reversedDepthBuffer, t.setRenderTarget(n, 0, i), f && !1 === t.autoClear && t.clearDepth(), t.render(e, a), t.setRenderTarget(n, 1, i), f && !1 === t.autoClear && t.clearDepth(), t.render(e, r), t.setRenderTarget(n, 2, i), f && !1 === t.autoClear && t.clearDepth(), t.render(e, s), t.setRenderTarget(n, 3, i), f && !1 === t.autoClear && t.clearDepth(), t.render(e, o), t.setRenderTarget(n, 4, i), f && !1 === t.autoClear && t.clearDepth(), t.render(e, l), n.texture.generateMipmaps = m, t.setRenderTarget(n, 5, i), f && !1 === t.autoClear && t.clearDepth(), t.render(e, c), t.setRenderTarget(h, u, d), t.xr.enabled = p, n.texture.needsPMREMUpdate = !0
        }
    },
    $i = class extends Xi {
        constructor(t = []) {
            super(), this.isArrayCamera = !0, this.isMultiViewCamera = !1, this.cameras = t
        }
    },
    Qi = "\\[\\]\\.:\\/",
    ta = new RegExp("[" + Qi + "]", "g"),
    ea = "[^" + Qi + "]",
    na = "[^" + Qi.replace("\\.", "") + "]",
    ia = new RegExp("^" + /((?:WC+[\/:])*)/.source.replace("WC", ea) + /(WCOD+)?/.source.replace("WCOD", na) + /(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC", ea) + /\.(WC+)(?:\[(.+)\])?/.source.replace("WC", ea) + "$"),
    aa = ["material", "materials", "bones", "map"],
    ra = class t {
        constructor(e, n, i) {
            this.path = n, this.parsedPath = i || t.parseTrackName(n), this.node = t.findNode(e, this.parsedPath.nodeName), this.rootNode = e, this.getValue = this._getValue_unbound, this.setValue = this._setValue_unbound
        }
        static create(e, n, i) {
            return e && e.isAnimationObjectGroup ? new t.Composite(e, n, i) : new t(e, n, i)
        }
        static sanitizeNodeName(t) {
            return t.replace(/\s/g, "_").replace(ta, "")
        }
        static parseTrackName(t) {
            const e = ia.exec(t);
            if (null === e) throw new Error("PropertyBinding: Cannot parse trackName: " + t);
            const n = {
                    nodeName: e[2],
                    objectName: e[3],
                    objectIndex: e[4],
                    propertyName: e[5],
                    propertyIndex: e[6]
                },
                i = n.nodeName && n.nodeName.lastIndexOf(".");
            if (void 0 !== i && -1 !== i) {
                const t = n.nodeName.substring(i + 1); - 1 !== aa.indexOf(t) && (n.nodeName = n.nodeName.substring(0, i), n.objectName = t)
            }
            if (null === n.propertyName || 0 === n.propertyName.length) throw new Error("PropertyBinding: can not parse propertyName from trackName: " + t);
            return n
        }
        static findNode(t, e) {
            if (void 0 === e || "" === e || "." === e || -1 === e || e === t.name || e === t.uuid) return t;
            if (t.skeleton) {
                const n = t.skeleton.getBoneByName(e);
                if (void 0 !== n) return n
            }
            if (t.children) {
                const n = function(t) {
                        for (let i = 0; i < t.length; i++) {
                            const a = t[i];
                            if (a.name === e || a.uuid === e) return a;
                            const r = n(a.children);
                            if (r) return r
                        }
                        return null
                    },
                    i = n(t.children);
                if (i) return i
            }
            return null
        }
        _getValue_unavailable() {}
        _setValue_unavailable() {}
        _getValue_direct(t, e) {
            t[e] = this.targetObject[this.propertyName]
        }
        _getValue_array(t, e) {
            const n = this.resolvedProperty;
            for (let i = 0, a = n.length; i !== a; ++i) t[e++] = n[i]
        }
        _getValue_arrayElement(t, e) {
            t[e] = this.resolvedProperty[this.propertyIndex]
        }
        _getValue_toArray(t, e) {
            this.resolvedProperty.toArray(t, e)
        }
        _setValue_direct(t, e) {
            this.targetObject[this.propertyName] = t[e]
        }
        _setValue_direct_setNeedsUpdate(t, e) {
            this.targetObject[this.propertyName] = t[e], this.targetObject.needsUpdate = !0
        }
        _setValue_direct_setMatrixWorldNeedsUpdate(t, e) {
            this.targetObject[this.propertyName] = t[e], this.targetObject.matrixWorldNeedsUpdate = !0
        }
        _setValue_array(t, e) {
            const n = this.resolvedProperty;
            for (let i = 0, a = n.length; i !== a; ++i) n[i] = t[e++]
        }
        _setValue_array_setNeedsUpdate(t, e) {
            const n = this.resolvedProperty;
            for (let i = 0, a = n.length; i !== a; ++i) n[i] = t[e++];
            this.targetObject.needsUpdate = !0
        }
        _setValue_array_setMatrixWorldNeedsUpdate(t, e) {
            const n = this.resolvedProperty;
            for (let i = 0, a = n.length; i !== a; ++i) n[i] = t[e++];
            this.targetObject.matrixWorldNeedsUpdate = !0
        }
        _setValue_arrayElement(t, e) {
            this.resolvedProperty[this.propertyIndex] = t[e]
        }
        _setValue_arrayElement_setNeedsUpdate(t, e) {
            this.resolvedProperty[this.propertyIndex] = t[e], this.targetObject.needsUpdate = !0
        }
        _setValue_arrayElement_setMatrixWorldNeedsUpdate(t, e) {
            this.resolvedProperty[this.propertyIndex] = t[e], this.targetObject.matrixWorldNeedsUpdate = !0
        }
        _setValue_fromArray(t, e) {
            this.resolvedProperty.fromArray(t, e)
        }
        _setValue_fromArray_setNeedsUpdate(t, e) {
            this.resolvedProperty.fromArray(t, e), this.targetObject.needsUpdate = !0
        }
        _setValue_fromArray_setMatrixWorldNeedsUpdate(t, e) {
            this.resolvedProperty.fromArray(t, e), this.targetObject.matrixWorldNeedsUpdate = !0
        }
        _getValue_unbound(t, e) {
            this.bind(), this.getValue(t, e)
        }
        _setValue_unbound(t, e) {
            this.bind(), this.setValue(t, e)
        }
        bind() {
            let e = this.node;
            const n = this.parsedPath,
                i = n.objectName,
                a = n.propertyName;
            let r = n.propertyIndex;
            if (e || (e = t.findNode(this.rootNode, n.nodeName), this.node = e), this.getValue = this._getValue_unavailable, this.setValue = this._setValue_unavailable, !e) return void k("PropertyBinding: No target node found for track: " + this.path + ".");
            if (i) {
                let t = n.objectIndex;
                switch (i) {
                    case "materials":
                        if (!e.material) return void H("PropertyBinding: Can not bind to material as node does not have a material.", this);
                        if (!e.material.materials) return void H("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.", this);
                        e = e.material.materials;
                        break;
                    case "bones":
                        if (!e.skeleton) return void H("PropertyBinding: Can not bind to bones as node does not have a skeleton.", this);
                        e = e.skeleton.bones;
                        for (let n = 0; n < e.length; n++)
                            if (e[n].name === t) {
                                t = n;
                                break
                            } break;
                    case "map":
                        if ("map" in e) {
                            e = e.map;
                            break
                        }
                        if (!e.material) return void H("PropertyBinding: Can not bind to material as node does not have a material.", this);
                        if (!e.material.map) return void H("PropertyBinding: Can not bind to material.map as node.material does not have a map.", this);
                        e = e.material.map;
                        break;
                    default:
                        if (void 0 === e[i]) return void H("PropertyBinding: Can not bind to objectName of node undefined.", this);
                        e = e[i]
                }
                if (void 0 !== t) {
                    if (void 0 === e[t]) return void H("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.", this, e);
                    e = e[t]
                }
            }
            const s = e[a];
            if (void 0 === s) {
                return void H("PropertyBinding: Trying to update property for track: " + n.nodeName + "." + a + " but it wasn't found.", e)
            }
            let o = this.Versioning.None;
            this.targetObject = e, !0 === e.isMaterial ? o = this.Versioning.NeedsUpdate : !0 === e.isObject3D && (o = this.Versioning.MatrixWorldNeedsUpdate);
            let l = this.BindingType.Direct;
            if (void 0 !== r) {
                if ("morphTargetInfluences" === a) {
                    if (!e.geometry) return void H("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.", this);
                    if (!e.geometry.morphAttributes) return void H("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.", this);
                    void 0 !== e.morphTargetDictionary[r] && (r = e.morphTargetDictionary[r])
                }
                l = this.BindingType.ArrayElement, this.resolvedProperty = s, this.propertyIndex = r
            } else void 0 !== s.fromArray && void 0 !== s.toArray ? (l = this.BindingType.HasFromToArray, this.resolvedProperty = s) : Array.isArray(s) ? (l = this.BindingType.EntireArray, this.resolvedProperty = s) : this.propertyName = a;
            this.getValue = this.GetterByBindingType[l], this.setValue = this.SetterByBindingTypeAndVersioning[l][o]
        }
        unbind() {
            this.node = null, this.getValue = this._getValue_unbound, this.setValue = this._setValue_unbound
        }
    };
ra.Composite = class {
    constructor(t, e, n) {
        const i = n || ra.parseTrackName(e);
        this._targetGroup = t, this._bindings = t.subscribe_(e, i)
    }
    getValue(t, e) {
        this.bind();
        const n = this._targetGroup.nCachedObjects_,
            i = this._bindings[n];
        void 0 !== i && i.getValue(t, e)
    }
    setValue(t, e) {
        const n = this._bindings;
        for (let i = this._targetGroup.nCachedObjects_, a = n.length; i !== a; ++i) n[i].setValue(t, e)
    }
    bind() {
        const t = this._bindings;
        for (let e = this._targetGroup.nCachedObjects_, n = t.length; e !== n; ++e) t[e].bind()
    }
    unbind() {
        const t = this._bindings;
        for (let e = this._targetGroup.nCachedObjects_, n = t.length; e !== n; ++e) t[e].unbind()
    }
}, ra.prototype.BindingType = {
    Direct: 0,
    EntireArray: 1,
    ArrayElement: 2,
    HasFromToArray: 3
}, ra.prototype.Versioning = {
    None: 0,
    NeedsUpdate: 1,
    MatrixWorldNeedsUpdate: 2
}, ra.prototype.GetterByBindingType = [ra.prototype._getValue_direct, ra.prototype._getValue_array, ra.prototype._getValue_arrayElement, ra.prototype._getValue_toArray], ra.prototype.SetterByBindingTypeAndVersioning = [
    [ra.prototype._setValue_direct, ra.prototype._setValue_direct_setNeedsUpdate, ra.prototype._setValue_direct_setMatrixWorldNeedsUpdate],
    [ra.prototype._setValue_array, ra.prototype._setValue_array_setNeedsUpdate, ra.prototype._setValue_array_setMatrixWorldNeedsUpdate],
    [ra.prototype._setValue_arrayElement, ra.prototype._setValue_arrayElement_setNeedsUpdate, ra.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],
    [ra.prototype._setValue_fromArray, ra.prototype._setValue_fromArray_setNeedsUpdate, ra.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]
];
var sa = new Ct,
    oa = class {
        constructor(t, e, n = 0, i = 1 / 0) {
            this.ray = new On(t, e), this.near = n, this.far = i, this.camera = null, this.layers = new Vt, this.params = {
                Mesh: {},
                Line: {
                    threshold: 1
                },
                LOD: {},
                Points: {
                    threshold: 1
                },
                Sprite: {}
            }
        }
        set(t, e) {
            this.ray.set(t, e)
        }
        setFromCamera(t, e) {
            e.isPerspectiveCamera ? (this.ray.origin.setFromMatrixPosition(e.matrixWorld), this.ray.direction.set(t.x, t.y, .5).unproject(e).sub(this.ray.origin).normalize(), this.camera = e) : e.isOrthographicCamera ? (this.ray.origin.set(t.x, t.y, (e.near + e.far) / (e.near - e.far)).unproject(e), this.ray.direction.set(0, 0, -1).transformDirection(e.matrixWorld), this.camera = e) : H("Raycaster: Unsupported camera type: " + e.type)
        }
        setFromXRController(t) {
            return sa.identity().extractRotation(t.matrixWorld), this.ray.origin.setFromMatrixPosition(t.matrixWorld), this.ray.direction.set(0, 0, -1).applyMatrix4(sa), this
        }
        intersectObject(t, e = !0, n = []) {
            return ca(t, this, n, e), n.sort(la), n
        }
        intersectObjects(t, e = !0, n = []) {
            for (let i = 0, a = t.length; i < a; i++) ca(t[i], this, n, e);
            return n.sort(la), n
        }
    };

function la(t, e) {
    return t.distance - e.distance
}

function ca(t, e, n, i) {
    let a = !0;
    if (t.layers.test(e.layers) && !1 === t.raycast(e, n) && (a = !1), !0 === a && !0 === i) {
        const i = t.children;
        for (let t = 0, a = i.length; t < a; t++) ca(i[t], e, n, !0)
    }
}
var ha = class {
        constructor(t = 1, e = 0, n = 0) {
            this.radius = t, this.phi = e, this.theta = n
        }
        set(t, e, n) {
            return this.radius = t, this.phi = e, this.theta = n, this
        }
        copy(t) {
            return this.radius = t.radius, this.phi = t.phi, this.theta = t.theta, this
        }
        makeSafe() {
            const t = 1e-6;
            return this.phi = J(this.phi, t, Math.PI - t), this
        }
        setFromVector3(t) {
            return this.setFromCartesianCoords(t.x, t.y, t.z)
        }
        setFromCartesianCoords(t, e, n) {
            return this.radius = Math.sqrt(t * t + e * e + n * n), 0 === this.radius ? (this.theta = 0, this.phi = 0) : (this.theta = Math.atan2(t, n), this.phi = Math.acos(J(e / this.radius, -1, 1))), this
        }
        clone() {
            return (new this.constructor).copy(this)
        }
    },
    ua = class extends X {
        constructor(t, e = null) {
            super(), this.object = t, this.domElement = e, this.enabled = !0, this.state = -1, this.keys = {}, this.mouseButtons = {
                LEFT: null,
                MIDDLE: null,
                RIGHT: null
            }, this.touches = {
                ONE: null,
                TWO: null
            }
        }
        connect(t) {
            void 0 !== t ? (null !== this.domElement && this.disconnect(), this.domElement = t) : k("Controls: connect() now requires an element.")
        }
        disconnect() {}
        dispose() {}
        update() {}
    };

function da(t, e, n, i) {
    const a = function(t) {
        switch (t) {
            case _:
            case 1010:
                return {
                    byteLength: 1, components: 1
                };
            case v:
            case 1011:
            case b:
                return {
                    byteLength: 2, components: 1
                };
            case y:
            case S:
                return {
                    byteLength: 2, components: 4
                };
            case x:
            case 1013:
            case M:
                return {
                    byteLength: 4, components: 1
                };
            case 35902:
            case 35899:
                return {
                    byteLength: 4, components: 3
                }
        }
        throw new Error(`Unknown texture type ${t}.`)
    }(i);
    switch (n) {
        case 1021:
            return t * e;
        case 1028:
        case 1029:
            return t * e / a.components * a.byteLength;
        case w:
        case 1031:
            return t * e * 2 / a.components * a.byteLength;
        case 1022:
            return t * e * 3 / a.components * a.byteLength;
        case E:
        case 1033:
            return t * e * 4 / a.components * a.byteLength;
        case 33776:
        case 33777:
            return Math.floor((t + 3) / 4) * Math.floor((e + 3) / 4) * 8;
        case 33778:
        case 33779:
            return Math.floor((t + 3) / 4) * Math.floor((e + 3) / 4) * 16;
        case 35841:
        case 35843:
            return Math.max(t, 16) * Math.max(e, 8) / 4;
        case 35840:
        case 35842:
            return Math.max(t, 8) * Math.max(e, 8) / 2;
        case 36196:
        case 37492:
        case 37488:
        case 37489:
            return Math.floor((t + 3) / 4) * Math.floor((e + 3) / 4) * 8;
        case 37496:
        case 37490:
        case 37491:
        case 37808:
            return Math.floor((t + 3) / 4) * Math.floor((e + 3) / 4) * 16;
        case 37809:
            return Math.floor((t + 4) / 5) * Math.floor((e + 3) / 4) * 16;
        case 37810:
            return Math.floor((t + 4) / 5) * Math.floor((e + 4) / 5) * 16;
        case 37811:
            return Math.floor((t + 5) / 6) * Math.floor((e + 4) / 5) * 16;
        case 37812:
            return Math.floor((t + 5) / 6) * Math.floor((e + 5) / 6) * 16;
        case 37813:
            return Math.floor((t + 7) / 8) * Math.floor((e + 4) / 5) * 16;
        case 37814:
            return Math.floor((t + 7) / 8) * Math.floor((e + 5) / 6) * 16;
        case 37815:
            return Math.floor((t + 7) / 8) * Math.floor((e + 7) / 8) * 16;
        case 37816:
            return Math.floor((t + 9) / 10) * Math.floor((e + 4) / 5) * 16;
        case 37817:
            return Math.floor((t + 9) / 10) * Math.floor((e + 5) / 6) * 16;
        case 37818:
            return Math.floor((t + 9) / 10) * Math.floor((e + 7) / 8) * 16;
        case 37819:
            return Math.floor((t + 9) / 10) * Math.floor((e + 9) / 10) * 16;
        case 37820:
            return Math.floor((t + 11) / 12) * Math.floor((e + 9) / 10) * 16;
        case 37821:
            return Math.floor((t + 11) / 12) * Math.floor((e + 11) / 12) * 16;
        case 36492:
        case 36494:
        case 36495:
            return Math.ceil(t / 4) * Math.ceil(e / 4) * 16;
        case 36283:
        case 36284:
            return Math.ceil(t / 4) * Math.ceil(e / 4) * 8;
        case 36285:
        case 36286:
            return Math.ceil(t / 4) * Math.ceil(e / 4) * 16
    }
    throw new Error(`Unable to determine texture byte length for ${n} format.`)
}

function pa() {
    let t = null,
        e = !1,
        n = null,
        i = null;

    function a(e, r) {
        n(e, r), i = t.requestAnimationFrame(a)
    }
    return {
        start: function() {
            !0 !== e && null !== n && (i = t.requestAnimationFrame(a), e = !0)
        },
        stop: function() {
            t.cancelAnimationFrame(i), e = !1
        },
        setAnimationLoop: function(t) {
            n = t
        },
        setContext: function(e) {
            t = e
        }
    }
}

function ma(t) {
    const e = new WeakMap;
    return {
        get: function(t) {
            return t.isInterleavedBufferAttribute && (t = t.data), e.get(t)
        },
        remove: function(n) {
            n.isInterleavedBufferAttribute && (n = n.data);
            const i = e.get(n);
            i && (t.deleteBuffer(i.buffer), e.delete(n))
        },
        update: function(n, i) {
            if (n.isInterleavedBufferAttribute && (n = n.data), n.isGLBufferAttribute) {
                const t = e.get(n);
                return void((!t || t.version < n.version) && e.set(n, {
                    buffer: n.buffer,
                    type: n.type,
                    bytesPerElement: n.elementSize,
                    version: n.version
                }))
            }
            const a = e.get(n);
            if (void 0 === a) e.set(n, function(e, n) {
                const i = e.array,
                    a = e.usage,
                    r = i.byteLength,
                    s = t.createBuffer();
                let o;
                if (t.bindBuffer(n, s), t.bufferData(n, i, a), e.onUploadCallback(), i instanceof Float32Array) o = t.FLOAT;
                else if ("undefined" != typeof Float16Array && i instanceof Float16Array) o = t.HALF_FLOAT;
                else if (i instanceof Uint16Array) o = e.isFloat16BufferAttribute ? t.HALF_FLOAT : t.UNSIGNED_SHORT;
                else if (i instanceof Int16Array) o = t.SHORT;
                else if (i instanceof Uint32Array) o = t.UNSIGNED_INT;
                else if (i instanceof Int32Array) o = t.INT;
                else if (i instanceof Int8Array) o = t.BYTE;
                else if (i instanceof Uint8Array) o = t.UNSIGNED_BYTE;
                else {
                    if (!(i instanceof Uint8ClampedArray)) throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: " + i);
                    o = t.UNSIGNED_BYTE
                }
                return {
                    buffer: s,
                    type: o,
                    bytesPerElement: i.BYTES_PER_ELEMENT,
                    version: e.version,
                    size: r
                }
            }(n, i));
            else if (a.version < n.version) {
                if (a.size !== n.array.byteLength) throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");
                ! function(e, n, i) {
                    const a = n.array,
                        r = n.updateRanges;
                    if (t.bindBuffer(i, e), 0 === r.length) t.bufferSubData(i, 0, a);
                    else {
                        r.sort((t, e) => t.start - e.start);
                        let e = 0;
                        for (let t = 1; t < r.length; t++) {
                            const n = r[e],
                                i = r[t];
                            i.start <= n.start + n.count + 1 ? n.count = Math.max(n.count, i.start + i.count - n.start) : (++e, r[e] = i)
                        }
                        r.length = e + 1;
                        for (let n = 0, s = r.length; n < s; n++) {
                            const e = r[n];
                            t.bufferSubData(i, e.start * a.BYTES_PER_ELEMENT, a, e.start, e.count)
                        }
                        n.clearUpdateRanges()
                    }
                    n.onUploadCallback()
                }(a.buffer, n, i), a.version = n.version
            }
        }
    }
}
"undefined" != typeof __THREE_DEVTOOLS__ && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register", {
    detail: {
        revision: "183"
    }
})), "undefined" != typeof window && (window.__THREE__ ? k("WARNING: Multiple instances of Three.js being imported.") : window.__THREE__ = "183");
var fa = {
        alphahash_fragment: "#ifdef USE_ALPHAHASH\n\tif ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;\n#endif",
        alphahash_pars_fragment: "#ifdef USE_ALPHAHASH\n\tconst float ALPHA_HASH_SCALE = 0.05;\n\tfloat hash2D( vec2 value ) {\n\t\treturn fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );\n\t}\n\tfloat hash3D( vec3 value ) {\n\t\treturn hash2D( vec2( hash2D( value.xy ), value.z ) );\n\t}\n\tfloat getAlphaHashThreshold( vec3 position ) {\n\t\tfloat maxDeriv = max(\n\t\t\tlength( dFdx( position.xyz ) ),\n\t\t\tlength( dFdy( position.xyz ) )\n\t\t);\n\t\tfloat pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );\n\t\tvec2 pixScales = vec2(\n\t\t\texp2( floor( log2( pixScale ) ) ),\n\t\t\texp2( ceil( log2( pixScale ) ) )\n\t\t);\n\t\tvec2 alpha = vec2(\n\t\t\thash3D( floor( pixScales.x * position.xyz ) ),\n\t\t\thash3D( floor( pixScales.y * position.xyz ) )\n\t\t);\n\t\tfloat lerpFactor = fract( log2( pixScale ) );\n\t\tfloat x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;\n\t\tfloat a = min( lerpFactor, 1.0 - lerpFactor );\n\t\tvec3 cases = vec3(\n\t\t\tx * x / ( 2.0 * a * ( 1.0 - a ) ),\n\t\t\t( x - 0.5 * a ) / ( 1.0 - a ),\n\t\t\t1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )\n\t\t);\n\t\tfloat threshold = ( x < ( 1.0 - a ) )\n\t\t\t? ( ( x < a ) ? cases.x : cases.y )\n\t\t\t: cases.z;\n\t\treturn clamp( threshold , 1.0e-6, 1.0 );\n\t}\n#endif",
        alphamap_fragment: "#ifdef USE_ALPHAMAP\n\tdiffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;\n#endif",
        alphamap_pars_fragment: "#ifdef USE_ALPHAMAP\n\tuniform sampler2D alphaMap;\n#endif",
        alphatest_fragment: "#ifdef USE_ALPHATEST\n\t#ifdef ALPHA_TO_COVERAGE\n\tdiffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );\n\tif ( diffuseColor.a == 0.0 ) discard;\n\t#else\n\tif ( diffuseColor.a < alphaTest ) discard;\n\t#endif\n#endif",
        alphatest_pars_fragment: "#ifdef USE_ALPHATEST\n\tuniform float alphaTest;\n#endif",
        aomap_fragment: "#ifdef USE_AOMAP\n\tfloat ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;\n\treflectedLight.indirectDiffuse *= ambientOcclusion;\n\t#if defined( USE_CLEARCOAT ) \n\t\tclearcoatSpecularIndirect *= ambientOcclusion;\n\t#endif\n\t#if defined( USE_SHEEN ) \n\t\tsheenSpecularIndirect *= ambientOcclusion;\n\t#endif\n\t#if defined( USE_ENVMAP ) && defined( STANDARD )\n\t\tfloat dotNV = saturate( dot( geometryNormal, geometryViewDir ) );\n\t\treflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );\n\t#endif\n#endif",
        aomap_pars_fragment: "#ifdef USE_AOMAP\n\tuniform sampler2D aoMap;\n\tuniform float aoMapIntensity;\n#endif",
        batching_pars_vertex: "#ifdef USE_BATCHING\n\t#if ! defined( GL_ANGLE_multi_draw )\n\t#define gl_DrawID _gl_DrawID\n\tuniform int _gl_DrawID;\n\t#endif\n\tuniform highp sampler2D batchingTexture;\n\tuniform highp usampler2D batchingIdTexture;\n\tmat4 getBatchingMatrix( const in float i ) {\n\t\tint size = textureSize( batchingTexture, 0 ).x;\n\t\tint j = int( i ) * 4;\n\t\tint x = j % size;\n\t\tint y = j / size;\n\t\tvec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );\n\t\tvec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );\n\t\tvec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );\n\t\tvec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );\n\t\treturn mat4( v1, v2, v3, v4 );\n\t}\n\tfloat getIndirectIndex( const in int i ) {\n\t\tint size = textureSize( batchingIdTexture, 0 ).x;\n\t\tint x = i % size;\n\t\tint y = i / size;\n\t\treturn float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );\n\t}\n#endif\n#ifdef USE_BATCHING_COLOR\n\tuniform sampler2D batchingColorTexture;\n\tvec4 getBatchingColor( const in float i ) {\n\t\tint size = textureSize( batchingColorTexture, 0 ).x;\n\t\tint j = int( i );\n\t\tint x = j % size;\n\t\tint y = j / size;\n\t\treturn texelFetch( batchingColorTexture, ivec2( x, y ), 0 );\n\t}\n#endif",
        batching_vertex: "#ifdef USE_BATCHING\n\tmat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );\n#endif",
        begin_vertex: "vec3 transformed = vec3( position );\n#ifdef USE_ALPHAHASH\n\tvPosition = vec3( position );\n#endif",
        beginnormal_vertex: "vec3 objectNormal = vec3( normal );\n#ifdef USE_TANGENT\n\tvec3 objectTangent = vec3( tangent.xyz );\n#endif",
        bsdfs: "float G_BlinnPhong_Implicit( ) {\n\treturn 0.25;\n}\nfloat D_BlinnPhong( const in float shininess, const in float dotNH ) {\n\treturn RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );\n}\nvec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {\n\tvec3 halfDir = normalize( lightDir + viewDir );\n\tfloat dotNH = saturate( dot( normal, halfDir ) );\n\tfloat dotVH = saturate( dot( viewDir, halfDir ) );\n\tvec3 F = F_Schlick( specularColor, 1.0, dotVH );\n\tfloat G = G_BlinnPhong_Implicit( );\n\tfloat D = D_BlinnPhong( shininess, dotNH );\n\treturn F * ( G * D );\n} // validated",
        iridescence_fragment: "#ifdef USE_IRIDESCENCE\n\tconst mat3 XYZ_TO_REC709 = mat3(\n\t\t 3.2404542, -0.9692660,  0.0556434,\n\t\t-1.5371385,  1.8760108, -0.2040259,\n\t\t-0.4985314,  0.0415560,  1.0572252\n\t);\n\tvec3 Fresnel0ToIor( vec3 fresnel0 ) {\n\t\tvec3 sqrtF0 = sqrt( fresnel0 );\n\t\treturn ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );\n\t}\n\tvec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {\n\t\treturn pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );\n\t}\n\tfloat IorToFresnel0( float transmittedIor, float incidentIor ) {\n\t\treturn pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));\n\t}\n\tvec3 evalSensitivity( float OPD, vec3 shift ) {\n\t\tfloat phase = 2.0 * PI * OPD * 1.0e-9;\n\t\tvec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );\n\t\tvec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );\n\t\tvec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );\n\t\tvec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );\n\t\txyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );\n\t\txyz /= 1.0685e-7;\n\t\tvec3 rgb = XYZ_TO_REC709 * xyz;\n\t\treturn rgb;\n\t}\n\tvec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {\n\t\tvec3 I;\n\t\tfloat iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );\n\t\tfloat sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );\n\t\tfloat cosTheta2Sq = 1.0 - sinTheta2Sq;\n\t\tif ( cosTheta2Sq < 0.0 ) {\n\t\t\treturn vec3( 1.0 );\n\t\t}\n\t\tfloat cosTheta2 = sqrt( cosTheta2Sq );\n\t\tfloat R0 = IorToFresnel0( iridescenceIOR, outsideIOR );\n\t\tfloat R12 = F_Schlick( R0, 1.0, cosTheta1 );\n\t\tfloat T121 = 1.0 - R12;\n\t\tfloat phi12 = 0.0;\n\t\tif ( iridescenceIOR < outsideIOR ) phi12 = PI;\n\t\tfloat phi21 = PI - phi12;\n\t\tvec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );\t\tvec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );\n\t\tvec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );\n\t\tvec3 phi23 = vec3( 0.0 );\n\t\tif ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;\n\t\tif ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;\n\t\tif ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;\n\t\tfloat OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;\n\t\tvec3 phi = vec3( phi21 ) + phi23;\n\t\tvec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );\n\t\tvec3 r123 = sqrt( R123 );\n\t\tvec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );\n\t\tvec3 C0 = R12 + Rs;\n\t\tI = C0;\n\t\tvec3 Cm = Rs - T121;\n\t\tfor ( int m = 1; m <= 2; ++ m ) {\n\t\t\tCm *= r123;\n\t\t\tvec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );\n\t\t\tI += Cm * Sm;\n\t\t}\n\t\treturn max( I, vec3( 0.0 ) );\n\t}\n#endif",
        bumpmap_pars_fragment: "#ifdef USE_BUMPMAP\n\tuniform sampler2D bumpMap;\n\tuniform float bumpScale;\n\tvec2 dHdxy_fwd() {\n\t\tvec2 dSTdx = dFdx( vBumpMapUv );\n\t\tvec2 dSTdy = dFdy( vBumpMapUv );\n\t\tfloat Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;\n\t\tfloat dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;\n\t\tfloat dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;\n\t\treturn vec2( dBx, dBy );\n\t}\n\tvec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {\n\t\tvec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );\n\t\tvec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );\n\t\tvec3 vN = surf_norm;\n\t\tvec3 R1 = cross( vSigmaY, vN );\n\t\tvec3 R2 = cross( vN, vSigmaX );\n\t\tfloat fDet = dot( vSigmaX, R1 ) * faceDirection;\n\t\tvec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );\n\t\treturn normalize( abs( fDet ) * surf_norm - vGrad );\n\t}\n#endif",
        clipping_planes_fragment: "#if NUM_CLIPPING_PLANES > 0\n\tvec4 plane;\n\t#ifdef ALPHA_TO_COVERAGE\n\t\tfloat distanceToPlane, distanceGradient;\n\t\tfloat clipOpacity = 1.0;\n\t\t#pragma unroll_loop_start\n\t\tfor ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {\n\t\t\tplane = clippingPlanes[ i ];\n\t\t\tdistanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;\n\t\t\tdistanceGradient = fwidth( distanceToPlane ) / 2.0;\n\t\t\tclipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );\n\t\t\tif ( clipOpacity == 0.0 ) discard;\n\t\t}\n\t\t#pragma unroll_loop_end\n\t\t#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES\n\t\t\tfloat unionClipOpacity = 1.0;\n\t\t\t#pragma unroll_loop_start\n\t\t\tfor ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {\n\t\t\t\tplane = clippingPlanes[ i ];\n\t\t\t\tdistanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;\n\t\t\t\tdistanceGradient = fwidth( distanceToPlane ) / 2.0;\n\t\t\t\tunionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );\n\t\t\t}\n\t\t\t#pragma unroll_loop_end\n\t\t\tclipOpacity *= 1.0 - unionClipOpacity;\n\t\t#endif\n\t\tdiffuseColor.a *= clipOpacity;\n\t\tif ( diffuseColor.a == 0.0 ) discard;\n\t#else\n\t\t#pragma unroll_loop_start\n\t\tfor ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {\n\t\t\tplane = clippingPlanes[ i ];\n\t\t\tif ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;\n\t\t}\n\t\t#pragma unroll_loop_end\n\t\t#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES\n\t\t\tbool clipped = true;\n\t\t\t#pragma unroll_loop_start\n\t\t\tfor ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {\n\t\t\t\tplane = clippingPlanes[ i ];\n\t\t\t\tclipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;\n\t\t\t}\n\t\t\t#pragma unroll_loop_end\n\t\t\tif ( clipped ) discard;\n\t\t#endif\n\t#endif\n#endif",
        clipping_planes_pars_fragment: "#if NUM_CLIPPING_PLANES > 0\n\tvarying vec3 vClipPosition;\n\tuniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];\n#endif",
        clipping_planes_pars_vertex: "#if NUM_CLIPPING_PLANES > 0\n\tvarying vec3 vClipPosition;\n#endif",
        clipping_planes_vertex: "#if NUM_CLIPPING_PLANES > 0\n\tvClipPosition = - mvPosition.xyz;\n#endif",
        color_fragment: "#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n\tdiffuseColor *= vColor;\n#endif",
        color_pars_fragment: "#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n\tvarying vec4 vColor;\n#endif",
        color_pars_vertex: "#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )\n\tvarying vec4 vColor;\n#endif",
        color_vertex: "#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )\n\tvColor = vec4( 1.0 );\n#endif\n#ifdef USE_COLOR_ALPHA\n\tvColor *= color;\n#elif defined( USE_COLOR )\n\tvColor.rgb *= color;\n#endif\n#ifdef USE_INSTANCING_COLOR\n\tvColor.rgb *= instanceColor.rgb;\n#endif\n#ifdef USE_BATCHING_COLOR\n\tvColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );\n#endif",
        common: "#define PI 3.141592653589793\n#define PI2 6.283185307179586\n#define PI_HALF 1.5707963267948966\n#define RECIPROCAL_PI 0.3183098861837907\n#define RECIPROCAL_PI2 0.15915494309189535\n#define EPSILON 1e-6\n#ifndef saturate\n#define saturate( a ) clamp( a, 0.0, 1.0 )\n#endif\n#define whiteComplement( a ) ( 1.0 - saturate( a ) )\nfloat pow2( const in float x ) { return x*x; }\nvec3 pow2( const in vec3 x ) { return x*x; }\nfloat pow3( const in float x ) { return x*x*x; }\nfloat pow4( const in float x ) { float x2 = x*x; return x2*x2; }\nfloat max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }\nfloat average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }\nhighp float rand( const in vec2 uv ) {\n\tconst highp float a = 12.9898, b = 78.233, c = 43758.5453;\n\thighp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );\n\treturn fract( sin( sn ) * c );\n}\n#ifdef HIGH_PRECISION\n\tfloat precisionSafeLength( vec3 v ) { return length( v ); }\n#else\n\tfloat precisionSafeLength( vec3 v ) {\n\t\tfloat maxComponent = max3( abs( v ) );\n\t\treturn length( v / maxComponent ) * maxComponent;\n\t}\n#endif\nstruct IncidentLight {\n\tvec3 color;\n\tvec3 direction;\n\tbool visible;\n};\nstruct ReflectedLight {\n\tvec3 directDiffuse;\n\tvec3 directSpecular;\n\tvec3 indirectDiffuse;\n\tvec3 indirectSpecular;\n};\n#ifdef USE_ALPHAHASH\n\tvarying vec3 vPosition;\n#endif\nvec3 transformDirection( in vec3 dir, in mat4 matrix ) {\n\treturn normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );\n}\nvec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {\n\treturn normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );\n}\nbool isPerspectiveMatrix( mat4 m ) {\n\treturn m[ 2 ][ 3 ] == - 1.0;\n}\nvec2 equirectUv( in vec3 dir ) {\n\tfloat u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;\n\tfloat v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;\n\treturn vec2( u, v );\n}\nvec3 BRDF_Lambert( const in vec3 diffuseColor ) {\n\treturn RECIPROCAL_PI * diffuseColor;\n}\nvec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {\n\tfloat fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );\n\treturn f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );\n}\nfloat F_Schlick( const in float f0, const in float f90, const in float dotVH ) {\n\tfloat fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );\n\treturn f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );\n} // validated",
        cube_uv_reflection_fragment: "#ifdef ENVMAP_TYPE_CUBE_UV\n\t#define cubeUV_minMipLevel 4.0\n\t#define cubeUV_minTileSize 16.0\n\tfloat getFace( vec3 direction ) {\n\t\tvec3 absDirection = abs( direction );\n\t\tfloat face = - 1.0;\n\t\tif ( absDirection.x > absDirection.z ) {\n\t\t\tif ( absDirection.x > absDirection.y )\n\t\t\t\tface = direction.x > 0.0 ? 0.0 : 3.0;\n\t\t\telse\n\t\t\t\tface = direction.y > 0.0 ? 1.0 : 4.0;\n\t\t} else {\n\t\t\tif ( absDirection.z > absDirection.y )\n\t\t\t\tface = direction.z > 0.0 ? 2.0 : 5.0;\n\t\t\telse\n\t\t\t\tface = direction.y > 0.0 ? 1.0 : 4.0;\n\t\t}\n\t\treturn face;\n\t}\n\tvec2 getUV( vec3 direction, float face ) {\n\t\tvec2 uv;\n\t\tif ( face == 0.0 ) {\n\t\t\tuv = vec2( direction.z, direction.y ) / abs( direction.x );\n\t\t} else if ( face == 1.0 ) {\n\t\t\tuv = vec2( - direction.x, - direction.z ) / abs( direction.y );\n\t\t} else if ( face == 2.0 ) {\n\t\t\tuv = vec2( - direction.x, direction.y ) / abs( direction.z );\n\t\t} else if ( face == 3.0 ) {\n\t\t\tuv = vec2( - direction.z, direction.y ) / abs( direction.x );\n\t\t} else if ( face == 4.0 ) {\n\t\t\tuv = vec2( - direction.x, direction.z ) / abs( direction.y );\n\t\t} else {\n\t\t\tuv = vec2( direction.x, direction.y ) / abs( direction.z );\n\t\t}\n\t\treturn 0.5 * ( uv + 1.0 );\n\t}\n\tvec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {\n\t\tfloat face = getFace( direction );\n\t\tfloat filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );\n\t\tmipInt = max( mipInt, cubeUV_minMipLevel );\n\t\tfloat faceSize = exp2( mipInt );\n\t\thighp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;\n\t\tif ( face > 2.0 ) {\n\t\t\tuv.y += faceSize;\n\t\t\tface -= 3.0;\n\t\t}\n\t\tuv.x += face * faceSize;\n\t\tuv.x += filterInt * 3.0 * cubeUV_minTileSize;\n\t\tuv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );\n\t\tuv.x *= CUBEUV_TEXEL_WIDTH;\n\t\tuv.y *= CUBEUV_TEXEL_HEIGHT;\n\t\t#ifdef texture2DGradEXT\n\t\t\treturn texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;\n\t\t#else\n\t\t\treturn texture2D( envMap, uv ).rgb;\n\t\t#endif\n\t}\n\t#define cubeUV_r0 1.0\n\t#define cubeUV_m0 - 2.0\n\t#define cubeUV_r1 0.8\n\t#define cubeUV_m1 - 1.0\n\t#define cubeUV_r4 0.4\n\t#define cubeUV_m4 2.0\n\t#define cubeUV_r5 0.305\n\t#define cubeUV_m5 3.0\n\t#define cubeUV_r6 0.21\n\t#define cubeUV_m6 4.0\n\tfloat roughnessToMip( float roughness ) {\n\t\tfloat mip = 0.0;\n\t\tif ( roughness >= cubeUV_r1 ) {\n\t\t\tmip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;\n\t\t} else if ( roughness >= cubeUV_r4 ) {\n\t\t\tmip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;\n\t\t} else if ( roughness >= cubeUV_r5 ) {\n\t\t\tmip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;\n\t\t} else if ( roughness >= cubeUV_r6 ) {\n\t\t\tmip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;\n\t\t} else {\n\t\t\tmip = - 2.0 * log2( 1.16 * roughness );\t\t}\n\t\treturn mip;\n\t}\n\tvec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {\n\t\tfloat mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );\n\t\tfloat mipF = fract( mip );\n\t\tfloat mipInt = floor( mip );\n\t\tvec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );\n\t\tif ( mipF == 0.0 ) {\n\t\t\treturn vec4( color0, 1.0 );\n\t\t} else {\n\t\t\tvec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );\n\t\t\treturn vec4( mix( color0, color1, mipF ), 1.0 );\n\t\t}\n\t}\n#endif",
        defaultnormal_vertex: "vec3 transformedNormal = objectNormal;\n#ifdef USE_TANGENT\n\tvec3 transformedTangent = objectTangent;\n#endif\n#ifdef USE_BATCHING\n\tmat3 bm = mat3( batchingMatrix );\n\ttransformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );\n\ttransformedNormal = bm * transformedNormal;\n\t#ifdef USE_TANGENT\n\t\ttransformedTangent = bm * transformedTangent;\n\t#endif\n#endif\n#ifdef USE_INSTANCING\n\tmat3 im = mat3( instanceMatrix );\n\ttransformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );\n\ttransformedNormal = im * transformedNormal;\n\t#ifdef USE_TANGENT\n\t\ttransformedTangent = im * transformedTangent;\n\t#endif\n#endif\ntransformedNormal = normalMatrix * transformedNormal;\n#ifdef FLIP_SIDED\n\ttransformedNormal = - transformedNormal;\n#endif\n#ifdef USE_TANGENT\n\ttransformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;\n\t#ifdef FLIP_SIDED\n\t\ttransformedTangent = - transformedTangent;\n\t#endif\n#endif",
        displacementmap_pars_vertex: "#ifdef USE_DISPLACEMENTMAP\n\tuniform sampler2D displacementMap;\n\tuniform float displacementScale;\n\tuniform float displacementBias;\n#endif",
        displacementmap_vertex: "#ifdef USE_DISPLACEMENTMAP\n\ttransformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );\n#endif",
        emissivemap_fragment: "#ifdef USE_EMISSIVEMAP\n\tvec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );\n\t#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE\n\t\temissiveColor = sRGBTransferEOTF( emissiveColor );\n\t#endif\n\ttotalEmissiveRadiance *= emissiveColor.rgb;\n#endif",
        emissivemap_pars_fragment: "#ifdef USE_EMISSIVEMAP\n\tuniform sampler2D emissiveMap;\n#endif",
        colorspace_fragment: "gl_FragColor = linearToOutputTexel( gl_FragColor );",
        colorspace_pars_fragment: "vec4 LinearTransferOETF( in vec4 value ) {\n\treturn value;\n}\nvec4 sRGBTransferEOTF( in vec4 value ) {\n\treturn vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );\n}\nvec4 sRGBTransferOETF( in vec4 value ) {\n\treturn vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );\n}",
        envmap_fragment: "#ifdef USE_ENVMAP\n\t#ifdef ENV_WORLDPOS\n\t\tvec3 cameraToFrag;\n\t\tif ( isOrthographic ) {\n\t\t\tcameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );\n\t\t} else {\n\t\t\tcameraToFrag = normalize( vWorldPosition - cameraPosition );\n\t\t}\n\t\tvec3 worldNormal = inverseTransformDirection( normal, viewMatrix );\n\t\t#ifdef ENVMAP_MODE_REFLECTION\n\t\t\tvec3 reflectVec = reflect( cameraToFrag, worldNormal );\n\t\t#else\n\t\t\tvec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );\n\t\t#endif\n\t#else\n\t\tvec3 reflectVec = vReflect;\n\t#endif\n\t#ifdef ENVMAP_TYPE_CUBE\n\t\tvec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );\n\t\t#ifdef ENVMAP_BLENDING_MULTIPLY\n\t\t\toutgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );\n\t\t#elif defined( ENVMAP_BLENDING_MIX )\n\t\t\toutgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );\n\t\t#elif defined( ENVMAP_BLENDING_ADD )\n\t\t\toutgoingLight += envColor.xyz * specularStrength * reflectivity;\n\t\t#endif\n\t#endif\n#endif",
        envmap_common_pars_fragment: "#ifdef USE_ENVMAP\n\tuniform float envMapIntensity;\n\tuniform float flipEnvMap;\n\tuniform mat3 envMapRotation;\n\t#ifdef ENVMAP_TYPE_CUBE\n\t\tuniform samplerCube envMap;\n\t#else\n\t\tuniform sampler2D envMap;\n\t#endif\n#endif",
        envmap_pars_fragment: "#ifdef USE_ENVMAP\n\tuniform float reflectivity;\n\t#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )\n\t\t#define ENV_WORLDPOS\n\t#endif\n\t#ifdef ENV_WORLDPOS\n\t\tvarying vec3 vWorldPosition;\n\t\tuniform float refractionRatio;\n\t#else\n\t\tvarying vec3 vReflect;\n\t#endif\n#endif",
        envmap_pars_vertex: "#ifdef USE_ENVMAP\n\t#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )\n\t\t#define ENV_WORLDPOS\n\t#endif\n\t#ifdef ENV_WORLDPOS\n\t\t\n\t\tvarying vec3 vWorldPosition;\n\t#else\n\t\tvarying vec3 vReflect;\n\t\tuniform float refractionRatio;\n\t#endif\n#endif",
        envmap_physical_pars_fragment: "#ifdef USE_ENVMAP\n\tvec3 getIBLIrradiance( const in vec3 normal ) {\n\t\t#ifdef ENVMAP_TYPE_CUBE_UV\n\t\t\tvec3 worldNormal = inverseTransformDirection( normal, viewMatrix );\n\t\t\tvec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );\n\t\t\treturn PI * envMapColor.rgb * envMapIntensity;\n\t\t#else\n\t\t\treturn vec3( 0.0 );\n\t\t#endif\n\t}\n\tvec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {\n\t\t#ifdef ENVMAP_TYPE_CUBE_UV\n\t\t\tvec3 reflectVec = reflect( - viewDir, normal );\n\t\t\treflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );\n\t\t\treflectVec = inverseTransformDirection( reflectVec, viewMatrix );\n\t\t\tvec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );\n\t\t\treturn envMapColor.rgb * envMapIntensity;\n\t\t#else\n\t\t\treturn vec3( 0.0 );\n\t\t#endif\n\t}\n\t#ifdef USE_ANISOTROPY\n\t\tvec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {\n\t\t\t#ifdef ENVMAP_TYPE_CUBE_UV\n\t\t\t\tvec3 bentNormal = cross( bitangent, viewDir );\n\t\t\t\tbentNormal = normalize( cross( bentNormal, bitangent ) );\n\t\t\t\tbentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );\n\t\t\t\treturn getIBLRadiance( viewDir, bentNormal, roughness );\n\t\t\t#else\n\t\t\t\treturn vec3( 0.0 );\n\t\t\t#endif\n\t\t}\n\t#endif\n#endif",
        envmap_vertex: "#ifdef USE_ENVMAP\n\t#ifdef ENV_WORLDPOS\n\t\tvWorldPosition = worldPosition.xyz;\n\t#else\n\t\tvec3 cameraToVertex;\n\t\tif ( isOrthographic ) {\n\t\t\tcameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );\n\t\t} else {\n\t\t\tcameraToVertex = normalize( worldPosition.xyz - cameraPosition );\n\t\t}\n\t\tvec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );\n\t\t#ifdef ENVMAP_MODE_REFLECTION\n\t\t\tvReflect = reflect( cameraToVertex, worldNormal );\n\t\t#else\n\t\t\tvReflect = refract( cameraToVertex, worldNormal, refractionRatio );\n\t\t#endif\n\t#endif\n#endif",
        fog_vertex: "#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n#endif",
        fog_pars_vertex: "#ifdef USE_FOG\n\tvarying float vFogDepth;\n#endif",
        fog_fragment: "#ifdef USE_FOG\n\t#ifdef FOG_EXP2\n\t\tfloat fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );\n\t#else\n\t\tfloat fogFactor = smoothstep( fogNear, fogFar, vFogDepth );\n\t#endif\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n#endif",
        fog_pars_fragment: "#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tvarying float vFogDepth;\n\t#ifdef FOG_EXP2\n\t\tuniform float fogDensity;\n\t#else\n\t\tuniform float fogNear;\n\t\tuniform float fogFar;\n\t#endif\n#endif",
        gradientmap_pars_fragment: "#ifdef USE_GRADIENTMAP\n\tuniform sampler2D gradientMap;\n#endif\nvec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {\n\tfloat dotNL = dot( normal, lightDirection );\n\tvec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );\n\t#ifdef USE_GRADIENTMAP\n\t\treturn vec3( texture2D( gradientMap, coord ).r );\n\t#else\n\t\tvec2 fw = fwidth( coord ) * 0.5;\n\t\treturn mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );\n\t#endif\n}",
        lightmap_pars_fragment: "#ifdef USE_LIGHTMAP\n\tuniform sampler2D lightMap;\n\tuniform float lightMapIntensity;\n#endif",
        lights_lambert_fragment: "LambertMaterial material;\nmaterial.diffuseColor = diffuseColor.rgb;\nmaterial.specularStrength = specularStrength;",
        lights_lambert_pars_fragment: "varying vec3 vViewPosition;\nstruct LambertMaterial {\n\tvec3 diffuseColor;\n\tfloat specularStrength;\n};\nvoid RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {\n\tfloat dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;\n\treflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}\nvoid RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {\n\treflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}\n#define RE_Direct\t\t\t\tRE_Direct_Lambert\n#define RE_IndirectDiffuse\t\tRE_IndirectDiffuse_Lambert",
        lights_pars_begin: "uniform bool receiveShadow;\nuniform vec3 ambientLightColor;\n#if defined( USE_LIGHT_PROBES )\n\tuniform vec3 lightProbe[ 9 ];\n#endif\nvec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {\n\tfloat x = normal.x, y = normal.y, z = normal.z;\n\tvec3 result = shCoefficients[ 0 ] * 0.886227;\n\tresult += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;\n\tresult += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;\n\tresult += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;\n\tresult += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;\n\tresult += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;\n\tresult += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );\n\tresult += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;\n\tresult += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );\n\treturn result;\n}\nvec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {\n\tvec3 worldNormal = inverseTransformDirection( normal, viewMatrix );\n\tvec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );\n\treturn irradiance;\n}\nvec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {\n\tvec3 irradiance = ambientLightColor;\n\treturn irradiance;\n}\nfloat getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {\n\tfloat distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );\n\tif ( cutoffDistance > 0.0 ) {\n\t\tdistanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );\n\t}\n\treturn distanceFalloff;\n}\nfloat getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {\n\treturn smoothstep( coneCosine, penumbraCosine, angleCosine );\n}\n#if NUM_DIR_LIGHTS > 0\n\tstruct DirectionalLight {\n\t\tvec3 direction;\n\t\tvec3 color;\n\t};\n\tuniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];\n\tvoid getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {\n\t\tlight.color = directionalLight.color;\n\t\tlight.direction = directionalLight.direction;\n\t\tlight.visible = true;\n\t}\n#endif\n#if NUM_POINT_LIGHTS > 0\n\tstruct PointLight {\n\t\tvec3 position;\n\t\tvec3 color;\n\t\tfloat distance;\n\t\tfloat decay;\n\t};\n\tuniform PointLight pointLights[ NUM_POINT_LIGHTS ];\n\tvoid getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {\n\t\tvec3 lVector = pointLight.position - geometryPosition;\n\t\tlight.direction = normalize( lVector );\n\t\tfloat lightDistance = length( lVector );\n\t\tlight.color = pointLight.color;\n\t\tlight.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );\n\t\tlight.visible = ( light.color != vec3( 0.0 ) );\n\t}\n#endif\n#if NUM_SPOT_LIGHTS > 0\n\tstruct SpotLight {\n\t\tvec3 position;\n\t\tvec3 direction;\n\t\tvec3 color;\n\t\tfloat distance;\n\t\tfloat decay;\n\t\tfloat coneCos;\n\t\tfloat penumbraCos;\n\t};\n\tuniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];\n\tvoid getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {\n\t\tvec3 lVector = spotLight.position - geometryPosition;\n\t\tlight.direction = normalize( lVector );\n\t\tfloat angleCos = dot( light.direction, spotLight.direction );\n\t\tfloat spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );\n\t\tif ( spotAttenuation > 0.0 ) {\n\t\t\tfloat lightDistance = length( lVector );\n\t\t\tlight.color = spotLight.color * spotAttenuation;\n\t\t\tlight.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );\n\t\t\tlight.visible = ( light.color != vec3( 0.0 ) );\n\t\t} else {\n\t\t\tlight.color = vec3( 0.0 );\n\t\t\tlight.visible = false;\n\t\t}\n\t}\n#endif\n#if NUM_RECT_AREA_LIGHTS > 0\n\tstruct RectAreaLight {\n\t\tvec3 color;\n\t\tvec3 position;\n\t\tvec3 halfWidth;\n\t\tvec3 halfHeight;\n\t};\n\tuniform sampler2D ltc_1;\tuniform sampler2D ltc_2;\n\tuniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];\n#endif\n#if NUM_HEMI_LIGHTS > 0\n\tstruct HemisphereLight {\n\t\tvec3 direction;\n\t\tvec3 skyColor;\n\t\tvec3 groundColor;\n\t};\n\tuniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];\n\tvec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {\n\t\tfloat dotNL = dot( normal, hemiLight.direction );\n\t\tfloat hemiDiffuseWeight = 0.5 * dotNL + 0.5;\n\t\tvec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );\n\t\treturn irradiance;\n\t}\n#endif",
        lights_toon_fragment: "ToonMaterial material;\nmaterial.diffuseColor = diffuseColor.rgb;",
        lights_toon_pars_fragment: "varying vec3 vViewPosition;\nstruct ToonMaterial {\n\tvec3 diffuseColor;\n};\nvoid RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {\n\tvec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;\n\treflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}\nvoid RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {\n\treflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}\n#define RE_Direct\t\t\t\tRE_Direct_Toon\n#define RE_IndirectDiffuse\t\tRE_IndirectDiffuse_Toon",
        lights_phong_fragment: "BlinnPhongMaterial material;\nmaterial.diffuseColor = diffuseColor.rgb;\nmaterial.specularColor = specular;\nmaterial.specularShininess = shininess;\nmaterial.specularStrength = specularStrength;",
        lights_phong_pars_fragment: "varying vec3 vViewPosition;\nstruct BlinnPhongMaterial {\n\tvec3 diffuseColor;\n\tvec3 specularColor;\n\tfloat specularShininess;\n\tfloat specularStrength;\n};\nvoid RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {\n\tfloat dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;\n\treflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n\treflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;\n}\nvoid RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {\n\treflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}\n#define RE_Direct\t\t\t\tRE_Direct_BlinnPhong\n#define RE_IndirectDiffuse\t\tRE_IndirectDiffuse_BlinnPhong",
        lights_physical_fragment: "PhysicalMaterial material;\nmaterial.diffuseColor = diffuseColor.rgb;\nmaterial.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );\nmaterial.metalness = metalnessFactor;\nvec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );\nfloat geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );\nmaterial.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;\nmaterial.roughness = min( material.roughness, 1.0 );\n#ifdef IOR\n\tmaterial.ior = ior;\n\t#ifdef USE_SPECULAR\n\t\tfloat specularIntensityFactor = specularIntensity;\n\t\tvec3 specularColorFactor = specularColor;\n\t\t#ifdef USE_SPECULAR_COLORMAP\n\t\t\tspecularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;\n\t\t#endif\n\t\t#ifdef USE_SPECULAR_INTENSITYMAP\n\t\t\tspecularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;\n\t\t#endif\n\t\tmaterial.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );\n\t#else\n\t\tfloat specularIntensityFactor = 1.0;\n\t\tvec3 specularColorFactor = vec3( 1.0 );\n\t\tmaterial.specularF90 = 1.0;\n\t#endif\n\tmaterial.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;\n\tmaterial.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );\n#else\n\tmaterial.specularColor = vec3( 0.04 );\n\tmaterial.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );\n\tmaterial.specularF90 = 1.0;\n#endif\n#ifdef USE_CLEARCOAT\n\tmaterial.clearcoat = clearcoat;\n\tmaterial.clearcoatRoughness = clearcoatRoughness;\n\tmaterial.clearcoatF0 = vec3( 0.04 );\n\tmaterial.clearcoatF90 = 1.0;\n\t#ifdef USE_CLEARCOATMAP\n\t\tmaterial.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;\n\t#endif\n\t#ifdef USE_CLEARCOAT_ROUGHNESSMAP\n\t\tmaterial.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;\n\t#endif\n\tmaterial.clearcoat = saturate( material.clearcoat );\tmaterial.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );\n\tmaterial.clearcoatRoughness += geometryRoughness;\n\tmaterial.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );\n#endif\n#ifdef USE_DISPERSION\n\tmaterial.dispersion = dispersion;\n#endif\n#ifdef USE_IRIDESCENCE\n\tmaterial.iridescence = iridescence;\n\tmaterial.iridescenceIOR = iridescenceIOR;\n\t#ifdef USE_IRIDESCENCEMAP\n\t\tmaterial.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;\n\t#endif\n\t#ifdef USE_IRIDESCENCE_THICKNESSMAP\n\t\tmaterial.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;\n\t#else\n\t\tmaterial.iridescenceThickness = iridescenceThicknessMaximum;\n\t#endif\n#endif\n#ifdef USE_SHEEN\n\tmaterial.sheenColor = sheenColor;\n\t#ifdef USE_SHEEN_COLORMAP\n\t\tmaterial.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;\n\t#endif\n\tmaterial.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );\n\t#ifdef USE_SHEEN_ROUGHNESSMAP\n\t\tmaterial.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;\n\t#endif\n#endif\n#ifdef USE_ANISOTROPY\n\t#ifdef USE_ANISOTROPYMAP\n\t\tmat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );\n\t\tvec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;\n\t\tvec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;\n\t#else\n\t\tvec2 anisotropyV = anisotropyVector;\n\t#endif\n\tmaterial.anisotropy = length( anisotropyV );\n\tif( material.anisotropy == 0.0 ) {\n\t\tanisotropyV = vec2( 1.0, 0.0 );\n\t} else {\n\t\tanisotropyV /= material.anisotropy;\n\t\tmaterial.anisotropy = saturate( material.anisotropy );\n\t}\n\tmaterial.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );\n\tmaterial.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;\n\tmaterial.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;\n#endif",
        lights_physical_pars_fragment: "uniform sampler2D dfgLUT;\nstruct PhysicalMaterial {\n\tvec3 diffuseColor;\n\tvec3 diffuseContribution;\n\tvec3 specularColor;\n\tvec3 specularColorBlended;\n\tfloat roughness;\n\tfloat metalness;\n\tfloat specularF90;\n\tfloat dispersion;\n\t#ifdef USE_CLEARCOAT\n\t\tfloat clearcoat;\n\t\tfloat clearcoatRoughness;\n\t\tvec3 clearcoatF0;\n\t\tfloat clearcoatF90;\n\t#endif\n\t#ifdef USE_IRIDESCENCE\n\t\tfloat iridescence;\n\t\tfloat iridescenceIOR;\n\t\tfloat iridescenceThickness;\n\t\tvec3 iridescenceFresnel;\n\t\tvec3 iridescenceF0;\n\t\tvec3 iridescenceFresnelDielectric;\n\t\tvec3 iridescenceFresnelMetallic;\n\t#endif\n\t#ifdef USE_SHEEN\n\t\tvec3 sheenColor;\n\t\tfloat sheenRoughness;\n\t#endif\n\t#ifdef IOR\n\t\tfloat ior;\n\t#endif\n\t#ifdef USE_TRANSMISSION\n\t\tfloat transmission;\n\t\tfloat transmissionAlpha;\n\t\tfloat thickness;\n\t\tfloat attenuationDistance;\n\t\tvec3 attenuationColor;\n\t#endif\n\t#ifdef USE_ANISOTROPY\n\t\tfloat anisotropy;\n\t\tfloat alphaT;\n\t\tvec3 anisotropyT;\n\t\tvec3 anisotropyB;\n\t#endif\n};\nvec3 clearcoatSpecularDirect = vec3( 0.0 );\nvec3 clearcoatSpecularIndirect = vec3( 0.0 );\nvec3 sheenSpecularDirect = vec3( 0.0 );\nvec3 sheenSpecularIndirect = vec3(0.0 );\nvec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {\n    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );\n    float x2 = x * x;\n    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );\n    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );\n}\nfloat V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {\n\tfloat a2 = pow2( alpha );\n\tfloat gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );\n\tfloat gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );\n\treturn 0.5 / max( gv + gl, EPSILON );\n}\nfloat D_GGX( const in float alpha, const in float dotNH ) {\n\tfloat a2 = pow2( alpha );\n\tfloat denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;\n\treturn RECIPROCAL_PI * a2 / pow2( denom );\n}\n#ifdef USE_ANISOTROPY\n\tfloat V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {\n\t\tfloat gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );\n\t\tfloat gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );\n\t\tfloat v = 0.5 / ( gv + gl );\n\t\treturn v;\n\t}\n\tfloat D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {\n\t\tfloat a2 = alphaT * alphaB;\n\t\thighp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );\n\t\thighp float v2 = dot( v, v );\n\t\tfloat w2 = a2 / v2;\n\t\treturn RECIPROCAL_PI * a2 * pow2 ( w2 );\n\t}\n#endif\n#ifdef USE_CLEARCOAT\n\tvec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {\n\t\tvec3 f0 = material.clearcoatF0;\n\t\tfloat f90 = material.clearcoatF90;\n\t\tfloat roughness = material.clearcoatRoughness;\n\t\tfloat alpha = pow2( roughness );\n\t\tvec3 halfDir = normalize( lightDir + viewDir );\n\t\tfloat dotNL = saturate( dot( normal, lightDir ) );\n\t\tfloat dotNV = saturate( dot( normal, viewDir ) );\n\t\tfloat dotNH = saturate( dot( normal, halfDir ) );\n\t\tfloat dotVH = saturate( dot( viewDir, halfDir ) );\n\t\tvec3 F = F_Schlick( f0, f90, dotVH );\n\t\tfloat V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );\n\t\tfloat D = D_GGX( alpha, dotNH );\n\t\treturn F * ( V * D );\n\t}\n#endif\nvec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {\n\tvec3 f0 = material.specularColorBlended;\n\tfloat f90 = material.specularF90;\n\tfloat roughness = material.roughness;\n\tfloat alpha = pow2( roughness );\n\tvec3 halfDir = normalize( lightDir + viewDir );\n\tfloat dotNL = saturate( dot( normal, lightDir ) );\n\tfloat dotNV = saturate( dot( normal, viewDir ) );\n\tfloat dotNH = saturate( dot( normal, halfDir ) );\n\tfloat dotVH = saturate( dot( viewDir, halfDir ) );\n\tvec3 F = F_Schlick( f0, f90, dotVH );\n\t#ifdef USE_IRIDESCENCE\n\t\tF = mix( F, material.iridescenceFresnel, material.iridescence );\n\t#endif\n\t#ifdef USE_ANISOTROPY\n\t\tfloat dotTL = dot( material.anisotropyT, lightDir );\n\t\tfloat dotTV = dot( material.anisotropyT, viewDir );\n\t\tfloat dotTH = dot( material.anisotropyT, halfDir );\n\t\tfloat dotBL = dot( material.anisotropyB, lightDir );\n\t\tfloat dotBV = dot( material.anisotropyB, viewDir );\n\t\tfloat dotBH = dot( material.anisotropyB, halfDir );\n\t\tfloat V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );\n\t\tfloat D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );\n\t#else\n\t\tfloat V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );\n\t\tfloat D = D_GGX( alpha, dotNH );\n\t#endif\n\treturn F * ( V * D );\n}\nvec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {\n\tconst float LUT_SIZE = 64.0;\n\tconst float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;\n\tconst float LUT_BIAS = 0.5 / LUT_SIZE;\n\tfloat dotNV = saturate( dot( N, V ) );\n\tvec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );\n\tuv = uv * LUT_SCALE + LUT_BIAS;\n\treturn uv;\n}\nfloat LTC_ClippedSphereFormFactor( const in vec3 f ) {\n\tfloat l = length( f );\n\treturn max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );\n}\nvec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {\n\tfloat x = dot( v1, v2 );\n\tfloat y = abs( x );\n\tfloat a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;\n\tfloat b = 3.4175940 + ( 4.1616724 + y ) * y;\n\tfloat v = a / b;\n\tfloat theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;\n\treturn cross( v1, v2 ) * theta_sintheta;\n}\nvec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {\n\tvec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];\n\tvec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];\n\tvec3 lightNormal = cross( v1, v2 );\n\tif( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );\n\tvec3 T1, T2;\n\tT1 = normalize( V - N * dot( V, N ) );\n\tT2 = - cross( N, T1 );\n\tmat3 mat = mInv * transpose( mat3( T1, T2, N ) );\n\tvec3 coords[ 4 ];\n\tcoords[ 0 ] = mat * ( rectCoords[ 0 ] - P );\n\tcoords[ 1 ] = mat * ( rectCoords[ 1 ] - P );\n\tcoords[ 2 ] = mat * ( rectCoords[ 2 ] - P );\n\tcoords[ 3 ] = mat * ( rectCoords[ 3 ] - P );\n\tcoords[ 0 ] = normalize( coords[ 0 ] );\n\tcoords[ 1 ] = normalize( coords[ 1 ] );\n\tcoords[ 2 ] = normalize( coords[ 2 ] );\n\tcoords[ 3 ] = normalize( coords[ 3 ] );\n\tvec3 vectorFormFactor = vec3( 0.0 );\n\tvectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );\n\tvectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );\n\tvectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );\n\tvectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );\n\tfloat result = LTC_ClippedSphereFormFactor( vectorFormFactor );\n\treturn vec3( result );\n}\n#if defined( USE_SHEEN )\nfloat D_Charlie( float roughness, float dotNH ) {\n\tfloat alpha = pow2( roughness );\n\tfloat invAlpha = 1.0 / alpha;\n\tfloat cos2h = dotNH * dotNH;\n\tfloat sin2h = max( 1.0 - cos2h, 0.0078125 );\n\treturn ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );\n}\nfloat V_Neubelt( float dotNV, float dotNL ) {\n\treturn saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );\n}\nvec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {\n\tvec3 halfDir = normalize( lightDir + viewDir );\n\tfloat dotNL = saturate( dot( normal, lightDir ) );\n\tfloat dotNV = saturate( dot( normal, viewDir ) );\n\tfloat dotNH = saturate( dot( normal, halfDir ) );\n\tfloat D = D_Charlie( sheenRoughness, dotNH );\n\tfloat V = V_Neubelt( dotNV, dotNL );\n\treturn sheenColor * ( D * V );\n}\n#endif\nfloat IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {\n\tfloat dotNV = saturate( dot( normal, viewDir ) );\n\tfloat r2 = roughness * roughness;\n\tfloat rInv = 1.0 / ( roughness + 0.1 );\n\tfloat a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;\n\tfloat b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;\n\tfloat DG = exp( a * dotNV + b );\n\treturn saturate( DG );\n}\nvec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {\n\tfloat dotNV = saturate( dot( normal, viewDir ) );\n\tvec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;\n\treturn specularColor * fab.x + specularF90 * fab.y;\n}\n#ifdef USE_IRIDESCENCE\nvoid computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {\n#else\nvoid computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {\n#endif\n\tfloat dotNV = saturate( dot( normal, viewDir ) );\n\tvec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;\n\t#ifdef USE_IRIDESCENCE\n\t\tvec3 Fr = mix( specularColor, iridescenceF0, iridescence );\n\t#else\n\t\tvec3 Fr = specularColor;\n\t#endif\n\tvec3 FssEss = Fr * fab.x + specularF90 * fab.y;\n\tfloat Ess = fab.x + fab.y;\n\tfloat Ems = 1.0 - Ess;\n\tvec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;\tvec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );\n\tsingleScatter += FssEss;\n\tmultiScatter += Fms * Ems;\n}\nvec3 BRDF_GGX_Multiscatter( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {\n\tvec3 singleScatter = BRDF_GGX( lightDir, viewDir, normal, material );\n\tfloat dotNL = saturate( dot( normal, lightDir ) );\n\tfloat dotNV = saturate( dot( normal, viewDir ) );\n\tvec2 dfgV = texture2D( dfgLUT, vec2( material.roughness, dotNV ) ).rg;\n\tvec2 dfgL = texture2D( dfgLUT, vec2( material.roughness, dotNL ) ).rg;\n\tvec3 FssEss_V = material.specularColorBlended * dfgV.x + material.specularF90 * dfgV.y;\n\tvec3 FssEss_L = material.specularColorBlended * dfgL.x + material.specularF90 * dfgL.y;\n\tfloat Ess_V = dfgV.x + dfgV.y;\n\tfloat Ess_L = dfgL.x + dfgL.y;\n\tfloat Ems_V = 1.0 - Ess_V;\n\tfloat Ems_L = 1.0 - Ess_L;\n\tvec3 Favg = material.specularColorBlended + ( 1.0 - material.specularColorBlended ) * 0.047619;\n\tvec3 Fms = FssEss_V * FssEss_L * Favg / ( 1.0 - Ems_V * Ems_L * Favg + EPSILON );\n\tfloat compensationFactor = Ems_V * Ems_L;\n\tvec3 multiScatter = Fms * compensationFactor;\n\treturn singleScatter + multiScatter;\n}\n#if NUM_RECT_AREA_LIGHTS > 0\n\tvoid RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {\n\t\tvec3 normal = geometryNormal;\n\t\tvec3 viewDir = geometryViewDir;\n\t\tvec3 position = geometryPosition;\n\t\tvec3 lightPos = rectAreaLight.position;\n\t\tvec3 halfWidth = rectAreaLight.halfWidth;\n\t\tvec3 halfHeight = rectAreaLight.halfHeight;\n\t\tvec3 lightColor = rectAreaLight.color;\n\t\tfloat roughness = material.roughness;\n\t\tvec3 rectCoords[ 4 ];\n\t\trectCoords[ 0 ] = lightPos + halfWidth - halfHeight;\t\trectCoords[ 1 ] = lightPos - halfWidth - halfHeight;\n\t\trectCoords[ 2 ] = lightPos - halfWidth + halfHeight;\n\t\trectCoords[ 3 ] = lightPos + halfWidth + halfHeight;\n\t\tvec2 uv = LTC_Uv( normal, viewDir, roughness );\n\t\tvec4 t1 = texture2D( ltc_1, uv );\n\t\tvec4 t2 = texture2D( ltc_2, uv );\n\t\tmat3 mInv = mat3(\n\t\t\tvec3( t1.x, 0, t1.y ),\n\t\t\tvec3(    0, 1,    0 ),\n\t\t\tvec3( t1.z, 0, t1.w )\n\t\t);\n\t\tvec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );\n\t\treflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );\n\t\treflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );\n\t\t#ifdef USE_CLEARCOAT\n\t\t\tvec3 Ncc = geometryClearcoatNormal;\n\t\t\tvec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );\n\t\t\tvec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );\n\t\t\tvec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );\n\t\t\tmat3 mInvClearcoat = mat3(\n\t\t\t\tvec3( t1Clearcoat.x, 0, t1Clearcoat.y ),\n\t\t\t\tvec3(             0, 1,             0 ),\n\t\t\t\tvec3( t1Clearcoat.z, 0, t1Clearcoat.w )\n\t\t\t);\n\t\t\tvec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;\n\t\t\tclearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );\n\t\t#endif\n\t}\n#endif\nvoid RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {\n\tfloat dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;\n\t#ifdef USE_CLEARCOAT\n\t\tfloat dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );\n\t\tvec3 ccIrradiance = dotNLcc * directLight.color;\n\t\tclearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );\n\t#endif\n\t#ifdef USE_SHEEN\n \n \t\tsheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );\n \n \t\tfloat sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );\n \t\tfloat sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );\n \n \t\tfloat sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );\n \n \t\tirradiance *= sheenEnergyComp;\n \n \t#endif\n\treflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter( directLight.direction, geometryViewDir, geometryNormal, material );\n\treflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );\n}\nvoid RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {\n\tvec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution );\n\t#ifdef USE_SHEEN\n\t\tfloat sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );\n\t\tfloat sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;\n\t\tdiffuse *= sheenEnergyComp;\n\t#endif\n\treflectedLight.indirectDiffuse += diffuse;\n}\nvoid RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {\n\t#ifdef USE_CLEARCOAT\n\t\tclearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );\n\t#endif\n\t#ifdef USE_SHEEN\n\t\tsheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;\n \t#endif\n\tvec3 singleScatteringDielectric = vec3( 0.0 );\n\tvec3 multiScatteringDielectric = vec3( 0.0 );\n\tvec3 singleScatteringMetallic = vec3( 0.0 );\n\tvec3 multiScatteringMetallic = vec3( 0.0 );\n\t#ifdef USE_IRIDESCENCE\n\t\tcomputeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnelDielectric, material.roughness, singleScatteringDielectric, multiScatteringDielectric );\n\t\tcomputeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceFresnelMetallic, material.roughness, singleScatteringMetallic, multiScatteringMetallic );\n\t#else\n\t\tcomputeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScatteringDielectric, multiScatteringDielectric );\n\t\tcomputeMultiscattering( geometryNormal, geometryViewDir, material.diffuseColor, material.specularF90, material.roughness, singleScatteringMetallic, multiScatteringMetallic );\n\t#endif\n\tvec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );\n\tvec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );\n\tvec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;\n\tvec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );\n\tvec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;\n\tvec3 indirectSpecular = radiance * singleScattering;\n\tindirectSpecular += multiScattering * cosineWeightedIrradiance;\n\tvec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;\n\t#ifdef USE_SHEEN\n\t\tfloat sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );\n\t\tfloat sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;\n\t\tindirectSpecular *= sheenEnergyComp;\n\t\tindirectDiffuse *= sheenEnergyComp;\n\t#endif\n\treflectedLight.indirectSpecular += indirectSpecular;\n\treflectedLight.indirectDiffuse += indirectDiffuse;\n}\n#define RE_Direct\t\t\t\tRE_Direct_Physical\n#define RE_Direct_RectArea\t\tRE_Direct_RectArea_Physical\n#define RE_IndirectDiffuse\t\tRE_IndirectDiffuse_Physical\n#define RE_IndirectSpecular\t\tRE_IndirectSpecular_Physical\nfloat computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {\n\treturn saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );\n}",
        lights_fragment_begin: "\nvec3 geometryPosition = - vViewPosition;\nvec3 geometryNormal = normal;\nvec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );\nvec3 geometryClearcoatNormal = vec3( 0.0 );\n#ifdef USE_CLEARCOAT\n\tgeometryClearcoatNormal = clearcoatNormal;\n#endif\n#ifdef USE_IRIDESCENCE\n\tfloat dotNVi = saturate( dot( normal, geometryViewDir ) );\n\tif ( material.iridescenceThickness == 0.0 ) {\n\t\tmaterial.iridescence = 0.0;\n\t} else {\n\t\tmaterial.iridescence = saturate( material.iridescence );\n\t}\n\tif ( material.iridescence > 0.0 ) {\n\t\tmaterial.iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );\n\t\tmaterial.iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );\n\t\tmaterial.iridescenceFresnel = mix( material.iridescenceFresnelDielectric, material.iridescenceFresnelMetallic, material.metalness );\n\t\tmaterial.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );\n\t}\n#endif\nIncidentLight directLight;\n#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )\n\tPointLight pointLight;\n\t#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0\n\tPointLightShadow pointLightShadow;\n\t#endif\n\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {\n\t\tpointLight = pointLights[ i ];\n\t\tgetPointLightInfo( pointLight, geometryPosition, directLight );\n\t\t#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )\n\t\tpointLightShadow = pointLightShadows[ i ];\n\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;\n\t\t#endif\n\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )\n\tSpotLight spotLight;\n\tvec4 spotColor;\n\tvec3 spotLightCoord;\n\tbool inSpotLightMap;\n\t#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0\n\tSpotLightShadow spotLightShadow;\n\t#endif\n\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {\n\t\tspotLight = spotLights[ i ];\n\t\tgetSpotLightInfo( spotLight, geometryPosition, directLight );\n\t\t#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )\n\t\t#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX\n\t\t#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )\n\t\t#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS\n\t\t#else\n\t\t#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )\n\t\t#endif\n\t\t#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )\n\t\t\tspotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;\n\t\t\tinSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );\n\t\t\tspotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );\n\t\t\tdirectLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;\n\t\t#endif\n\t\t#undef SPOT_LIGHT_MAP_INDEX\n\t\t#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )\n\t\tspotLightShadow = spotLightShadows[ i ];\n\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;\n\t\t#endif\n\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )\n\tDirectionalLight directionalLight;\n\t#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0\n\tDirectionalLightShadow directionalLightShadow;\n\t#endif\n\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {\n\t\tdirectionalLight = directionalLights[ i ];\n\t\tgetDirectionalLightInfo( directionalLight, directLight );\n\t\t#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )\n\t\tdirectionalLightShadow = directionalLightShadows[ i ];\n\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;\n\t\t#endif\n\t\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )\n\tRectAreaLight rectAreaLight;\n\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {\n\t\trectAreaLight = rectAreaLights[ i ];\n\t\tRE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if defined( RE_IndirectDiffuse )\n\tvec3 iblIrradiance = vec3( 0.0 );\n\tvec3 irradiance = getAmbientLightIrradiance( ambientLightColor );\n\t#if defined( USE_LIGHT_PROBES )\n\t\tirradiance += getLightProbeIrradiance( lightProbe, geometryNormal );\n\t#endif\n\t#if ( NUM_HEMI_LIGHTS > 0 )\n\t\t#pragma unroll_loop_start\n\t\tfor ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {\n\t\t\tirradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );\n\t\t}\n\t\t#pragma unroll_loop_end\n\t#endif\n#endif\n#if defined( RE_IndirectSpecular )\n\tvec3 radiance = vec3( 0.0 );\n\tvec3 clearcoatRadiance = vec3( 0.0 );\n#endif",
        lights_fragment_maps: "#if defined( RE_IndirectDiffuse )\n\t#ifdef USE_LIGHTMAP\n\t\tvec4 lightMapTexel = texture2D( lightMap, vLightMapUv );\n\t\tvec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;\n\t\tirradiance += lightMapIrradiance;\n\t#endif\n\t#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )\n\t\t#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )\n\t\t\tiblIrradiance += getIBLIrradiance( geometryNormal );\n\t\t#endif\n\t#endif\n#endif\n#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )\n\t#ifdef USE_ANISOTROPY\n\t\tradiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );\n\t#else\n\t\tradiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );\n\t#endif\n\t#ifdef USE_CLEARCOAT\n\t\tclearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );\n\t#endif\n#endif",
        lights_fragment_end: "#if defined( RE_IndirectDiffuse )\n\t#if defined( LAMBERT ) || defined( PHONG )\n\t\tirradiance += iblIrradiance;\n\t#endif\n\tRE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n#endif\n#if defined( RE_IndirectSpecular )\n\tRE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n#endif",
        logdepthbuf_fragment: "#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\n\tgl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;\n#endif",
        logdepthbuf_pars_fragment: "#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )\n\tuniform float logDepthBufFC;\n\tvarying float vFragDepth;\n\tvarying float vIsPerspective;\n#endif",
        logdepthbuf_pars_vertex: "#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\n\tvarying float vFragDepth;\n\tvarying float vIsPerspective;\n#endif",
        logdepthbuf_vertex: "#ifdef USE_LOGARITHMIC_DEPTH_BUFFER\n\tvFragDepth = 1.0 + gl_Position.w;\n\tvIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );\n#endif",
        map_fragment: "#ifdef USE_MAP\n\tvec4 sampledDiffuseColor = texture2D( map, vMapUv );\n\t#ifdef DECODE_VIDEO_TEXTURE\n\t\tsampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );\n\t#endif\n\tdiffuseColor *= sampledDiffuseColor;\n#endif",
        map_pars_fragment: "#ifdef USE_MAP\n\tuniform sampler2D map;\n#endif",
        map_particle_fragment: "#if defined( USE_MAP ) || defined( USE_ALPHAMAP )\n\t#if defined( USE_POINTS_UV )\n\t\tvec2 uv = vUv;\n\t#else\n\t\tvec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;\n\t#endif\n#endif\n#ifdef USE_MAP\n\tdiffuseColor *= texture2D( map, uv );\n#endif\n#ifdef USE_ALPHAMAP\n\tdiffuseColor.a *= texture2D( alphaMap, uv ).g;\n#endif",
        map_particle_pars_fragment: "#if defined( USE_POINTS_UV )\n\tvarying vec2 vUv;\n#else\n\t#if defined( USE_MAP ) || defined( USE_ALPHAMAP )\n\t\tuniform mat3 uvTransform;\n\t#endif\n#endif\n#ifdef USE_MAP\n\tuniform sampler2D map;\n#endif\n#ifdef USE_ALPHAMAP\n\tuniform sampler2D alphaMap;\n#endif",
        metalnessmap_fragment: "float metalnessFactor = metalness;\n#ifdef USE_METALNESSMAP\n\tvec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );\n\tmetalnessFactor *= texelMetalness.b;\n#endif",
        metalnessmap_pars_fragment: "#ifdef USE_METALNESSMAP\n\tuniform sampler2D metalnessMap;\n#endif",
        morphinstance_vertex: "#ifdef USE_INSTANCING_MORPH\n\tfloat morphTargetInfluences[ MORPHTARGETS_COUNT ];\n\tfloat morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;\n\tfor ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {\n\t\tmorphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;\n\t}\n#endif",
        morphcolor_vertex: "#if defined( USE_MORPHCOLORS )\n\tvColor *= morphTargetBaseInfluence;\n\tfor ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {\n\t\t#if defined( USE_COLOR_ALPHA )\n\t\t\tif ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];\n\t\t#elif defined( USE_COLOR )\n\t\t\tif ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];\n\t\t#endif\n\t}\n#endif",
        morphnormal_vertex: "#ifdef USE_MORPHNORMALS\n\tobjectNormal *= morphTargetBaseInfluence;\n\tfor ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {\n\t\tif ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];\n\t}\n#endif",
        morphtarget_pars_vertex: "#ifdef USE_MORPHTARGETS\n\t#ifndef USE_INSTANCING_MORPH\n\t\tuniform float morphTargetBaseInfluence;\n\t\tuniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];\n\t#endif\n\tuniform sampler2DArray morphTargetsTexture;\n\tuniform ivec2 morphTargetsTextureSize;\n\tvec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {\n\t\tint texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;\n\t\tint y = texelIndex / morphTargetsTextureSize.x;\n\t\tint x = texelIndex - y * morphTargetsTextureSize.x;\n\t\tivec3 morphUV = ivec3( x, y, morphTargetIndex );\n\t\treturn texelFetch( morphTargetsTexture, morphUV, 0 );\n\t}\n#endif",
        morphtarget_vertex: "#ifdef USE_MORPHTARGETS\n\ttransformed *= morphTargetBaseInfluence;\n\tfor ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {\n\t\tif ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];\n\t}\n#endif",
        normal_fragment_begin: "float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;\n#ifdef FLAT_SHADED\n\tvec3 fdx = dFdx( vViewPosition );\n\tvec3 fdy = dFdy( vViewPosition );\n\tvec3 normal = normalize( cross( fdx, fdy ) );\n#else\n\tvec3 normal = normalize( vNormal );\n\t#ifdef DOUBLE_SIDED\n\t\tnormal *= faceDirection;\n\t#endif\n#endif\n#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )\n\t#ifdef USE_TANGENT\n\t\tmat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );\n\t#else\n\t\tmat3 tbn = getTangentFrame( - vViewPosition, normal,\n\t\t#if defined( USE_NORMALMAP )\n\t\t\tvNormalMapUv\n\t\t#elif defined( USE_CLEARCOAT_NORMALMAP )\n\t\t\tvClearcoatNormalMapUv\n\t\t#else\n\t\t\tvUv\n\t\t#endif\n\t\t);\n\t#endif\n\t#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )\n\t\ttbn[0] *= faceDirection;\n\t\ttbn[1] *= faceDirection;\n\t#endif\n#endif\n#ifdef USE_CLEARCOAT_NORMALMAP\n\t#ifdef USE_TANGENT\n\t\tmat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );\n\t#else\n\t\tmat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );\n\t#endif\n\t#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )\n\t\ttbn2[0] *= faceDirection;\n\t\ttbn2[1] *= faceDirection;\n\t#endif\n#endif\nvec3 nonPerturbedNormal = normal;",
        normal_fragment_maps: "#ifdef USE_NORMALMAP_OBJECTSPACE\n\tnormal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n\t#ifdef FLIP_SIDED\n\t\tnormal = - normal;\n\t#endif\n\t#ifdef DOUBLE_SIDED\n\t\tnormal = normal * faceDirection;\n\t#endif\n\tnormal = normalize( normalMatrix * normal );\n#elif defined( USE_NORMALMAP_TANGENTSPACE )\n\tvec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n\tmapN.xy *= normalScale;\n\tnormal = normalize( tbn * mapN );\n#elif defined( USE_BUMPMAP )\n\tnormal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );\n#endif",
        normal_pars_fragment: "#ifndef FLAT_SHADED\n\tvarying vec3 vNormal;\n\t#ifdef USE_TANGENT\n\t\tvarying vec3 vTangent;\n\t\tvarying vec3 vBitangent;\n\t#endif\n#endif",
        normal_pars_vertex: "#ifndef FLAT_SHADED\n\tvarying vec3 vNormal;\n\t#ifdef USE_TANGENT\n\t\tvarying vec3 vTangent;\n\t\tvarying vec3 vBitangent;\n\t#endif\n#endif",
        normal_vertex: "#ifndef FLAT_SHADED\n\tvNormal = normalize( transformedNormal );\n\t#ifdef USE_TANGENT\n\t\tvTangent = normalize( transformedTangent );\n\t\tvBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );\n\t#endif\n#endif",
        normalmap_pars_fragment: "#ifdef USE_NORMALMAP\n\tuniform sampler2D normalMap;\n\tuniform vec2 normalScale;\n#endif\n#ifdef USE_NORMALMAP_OBJECTSPACE\n\tuniform mat3 normalMatrix;\n#endif\n#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )\n\tmat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {\n\t\tvec3 q0 = dFdx( eye_pos.xyz );\n\t\tvec3 q1 = dFdy( eye_pos.xyz );\n\t\tvec2 st0 = dFdx( uv.st );\n\t\tvec2 st1 = dFdy( uv.st );\n\t\tvec3 N = surf_norm;\n\t\tvec3 q1perp = cross( q1, N );\n\t\tvec3 q0perp = cross( N, q0 );\n\t\tvec3 T = q1perp * st0.x + q0perp * st1.x;\n\t\tvec3 B = q1perp * st0.y + q0perp * st1.y;\n\t\tfloat det = max( dot( T, T ), dot( B, B ) );\n\t\tfloat scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );\n\t\treturn mat3( T * scale, B * scale, N );\n\t}\n#endif",
        clearcoat_normal_fragment_begin: "#ifdef USE_CLEARCOAT\n\tvec3 clearcoatNormal = nonPerturbedNormal;\n#endif",
        clearcoat_normal_fragment_maps: "#ifdef USE_CLEARCOAT_NORMALMAP\n\tvec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;\n\tclearcoatMapN.xy *= clearcoatNormalScale;\n\tclearcoatNormal = normalize( tbn2 * clearcoatMapN );\n#endif",
        clearcoat_pars_fragment: "#ifdef USE_CLEARCOATMAP\n\tuniform sampler2D clearcoatMap;\n#endif\n#ifdef USE_CLEARCOAT_NORMALMAP\n\tuniform sampler2D clearcoatNormalMap;\n\tuniform vec2 clearcoatNormalScale;\n#endif\n#ifdef USE_CLEARCOAT_ROUGHNESSMAP\n\tuniform sampler2D clearcoatRoughnessMap;\n#endif",
        iridescence_pars_fragment: "#ifdef USE_IRIDESCENCEMAP\n\tuniform sampler2D iridescenceMap;\n#endif\n#ifdef USE_IRIDESCENCE_THICKNESSMAP\n\tuniform sampler2D iridescenceThicknessMap;\n#endif",
        opaque_fragment: "#ifdef OPAQUE\ndiffuseColor.a = 1.0;\n#endif\n#ifdef USE_TRANSMISSION\ndiffuseColor.a *= material.transmissionAlpha;\n#endif\ngl_FragColor = vec4( outgoingLight, diffuseColor.a );",
        packing: "vec3 packNormalToRGB( const in vec3 normal ) {\n\treturn normalize( normal ) * 0.5 + 0.5;\n}\nvec3 unpackRGBToNormal( const in vec3 rgb ) {\n\treturn 2.0 * rgb.xyz - 1.0;\n}\nconst float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;\nconst float Inv255 = 1. / 255.;\nconst vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );\nconst vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );\nconst vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );\nconst vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );\nvec4 packDepthToRGBA( const in float v ) {\n\tif( v <= 0.0 )\n\t\treturn vec4( 0., 0., 0., 0. );\n\tif( v >= 1.0 )\n\t\treturn vec4( 1., 1., 1., 1. );\n\tfloat vuf;\n\tfloat af = modf( v * PackFactors.a, vuf );\n\tfloat bf = modf( vuf * ShiftRight8, vuf );\n\tfloat gf = modf( vuf * ShiftRight8, vuf );\n\treturn vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );\n}\nvec3 packDepthToRGB( const in float v ) {\n\tif( v <= 0.0 )\n\t\treturn vec3( 0., 0., 0. );\n\tif( v >= 1.0 )\n\t\treturn vec3( 1., 1., 1. );\n\tfloat vuf;\n\tfloat bf = modf( v * PackFactors.b, vuf );\n\tfloat gf = modf( vuf * ShiftRight8, vuf );\n\treturn vec3( vuf * Inv255, gf * PackUpscale, bf );\n}\nvec2 packDepthToRG( const in float v ) {\n\tif( v <= 0.0 )\n\t\treturn vec2( 0., 0. );\n\tif( v >= 1.0 )\n\t\treturn vec2( 1., 1. );\n\tfloat vuf;\n\tfloat gf = modf( v * 256., vuf );\n\treturn vec2( vuf * Inv255, gf );\n}\nfloat unpackRGBAToDepth( const in vec4 v ) {\n\treturn dot( v, UnpackFactors4 );\n}\nfloat unpackRGBToDepth( const in vec3 v ) {\n\treturn dot( v, UnpackFactors3 );\n}\nfloat unpackRGToDepth( const in vec2 v ) {\n\treturn v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;\n}\nvec4 pack2HalfToRGBA( const in vec2 v ) {\n\tvec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );\n\treturn vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );\n}\nvec2 unpackRGBATo2Half( const in vec4 v ) {\n\treturn vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );\n}\nfloat viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {\n\treturn ( viewZ + near ) / ( near - far );\n}\nfloat orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {\n\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\n\t\treturn depth * ( far - near ) - far;\n\t#else\n\t\treturn depth * ( near - far ) - near;\n\t#endif\n}\nfloat viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {\n\treturn ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );\n}\nfloat perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {\n\t\n\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\treturn ( near * far ) / ( ( near - far ) * depth - near );\n\t#else\n\t\treturn ( near * far ) / ( ( far - near ) * depth - far );\n\t#endif\n}",
        premultiplied_alpha_fragment: "#ifdef PREMULTIPLIED_ALPHA\n\tgl_FragColor.rgb *= gl_FragColor.a;\n#endif",
        project_vertex: "vec4 mvPosition = vec4( transformed, 1.0 );\n#ifdef USE_BATCHING\n\tmvPosition = batchingMatrix * mvPosition;\n#endif\n#ifdef USE_INSTANCING\n\tmvPosition = instanceMatrix * mvPosition;\n#endif\nmvPosition = modelViewMatrix * mvPosition;\ngl_Position = projectionMatrix * mvPosition;",
        dithering_fragment: "#ifdef DITHERING\n\tgl_FragColor.rgb = dithering( gl_FragColor.rgb );\n#endif",
        dithering_pars_fragment: "#ifdef DITHERING\n\tvec3 dithering( vec3 color ) {\n\t\tfloat grid_position = rand( gl_FragCoord.xy );\n\t\tvec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );\n\t\tdither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );\n\t\treturn color + dither_shift_RGB;\n\t}\n#endif",
        roughnessmap_fragment: "float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n\tvec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );\n\troughnessFactor *= texelRoughness.g;\n#endif",
        roughnessmap_pars_fragment: "#ifdef USE_ROUGHNESSMAP\n\tuniform sampler2D roughnessMap;\n#endif",
        shadowmap_pars_fragment: "#if NUM_SPOT_LIGHT_COORDS > 0\n\tvarying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];\n#endif\n#if NUM_SPOT_LIGHT_MAPS > 0\n\tuniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];\n#endif\n#ifdef USE_SHADOWMAP\n\t#if NUM_DIR_LIGHT_SHADOWS > 0\n\t\t#if defined( SHADOWMAP_TYPE_PCF )\n\t\t\tuniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];\n\t\t#else\n\t\t\tuniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];\n\t\t#endif\n\t\tvarying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];\n\t\tstruct DirectionalLightShadow {\n\t\t\tfloat shadowIntensity;\n\t\t\tfloat shadowBias;\n\t\t\tfloat shadowNormalBias;\n\t\t\tfloat shadowRadius;\n\t\t\tvec2 shadowMapSize;\n\t\t};\n\t\tuniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];\n\t#endif\n\t#if NUM_SPOT_LIGHT_SHADOWS > 0\n\t\t#if defined( SHADOWMAP_TYPE_PCF )\n\t\t\tuniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];\n\t\t#else\n\t\t\tuniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];\n\t\t#endif\n\t\tstruct SpotLightShadow {\n\t\t\tfloat shadowIntensity;\n\t\t\tfloat shadowBias;\n\t\t\tfloat shadowNormalBias;\n\t\t\tfloat shadowRadius;\n\t\t\tvec2 shadowMapSize;\n\t\t};\n\t\tuniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];\n\t#endif\n\t#if NUM_POINT_LIGHT_SHADOWS > 0\n\t\t#if defined( SHADOWMAP_TYPE_PCF )\n\t\t\tuniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];\n\t\t#elif defined( SHADOWMAP_TYPE_BASIC )\n\t\t\tuniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];\n\t\t#endif\n\t\tvarying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];\n\t\tstruct PointLightShadow {\n\t\t\tfloat shadowIntensity;\n\t\t\tfloat shadowBias;\n\t\t\tfloat shadowNormalBias;\n\t\t\tfloat shadowRadius;\n\t\t\tvec2 shadowMapSize;\n\t\t\tfloat shadowCameraNear;\n\t\t\tfloat shadowCameraFar;\n\t\t};\n\t\tuniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];\n\t#endif\n\t#if defined( SHADOWMAP_TYPE_PCF )\n\t\tfloat interleavedGradientNoise( vec2 position ) {\n\t\t\treturn fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );\n\t\t}\n\t\tvec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {\n\t\t\tconst float goldenAngle = 2.399963229728653;\n\t\t\tfloat r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );\n\t\t\tfloat theta = float( sampleIndex ) * goldenAngle + phi;\n\t\t\treturn vec2( cos( theta ), sin( theta ) ) * r;\n\t\t}\n\t#endif\n\t#if defined( SHADOWMAP_TYPE_PCF )\n\t\tfloat getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n\t\t\tfloat shadow = 1.0;\n\t\t\tshadowCoord.xyz /= shadowCoord.w;\n\t\t\tshadowCoord.z += shadowBias;\n\t\t\tbool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;\n\t\t\tbool frustumTest = inFrustum && shadowCoord.z <= 1.0;\n\t\t\tif ( frustumTest ) {\n\t\t\t\tvec2 texelSize = vec2( 1.0 ) / shadowMapSize;\n\t\t\t\tfloat radius = shadowRadius * texelSize.x;\n\t\t\t\tfloat phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;\n\t\t\t\tshadow = (\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )\n\t\t\t\t) * 0.2;\n\t\t\t}\n\t\t\treturn mix( 1.0, shadow, shadowIntensity );\n\t\t}\n\t#elif defined( SHADOWMAP_TYPE_VSM )\n\t\tfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n\t\t\tfloat shadow = 1.0;\n\t\t\tshadowCoord.xyz /= shadowCoord.w;\n\t\t\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\tshadowCoord.z -= shadowBias;\n\t\t\t#else\n\t\t\t\tshadowCoord.z += shadowBias;\n\t\t\t#endif\n\t\t\tbool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;\n\t\t\tbool frustumTest = inFrustum && shadowCoord.z <= 1.0;\n\t\t\tif ( frustumTest ) {\n\t\t\t\tvec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;\n\t\t\t\tfloat mean = distribution.x;\n\t\t\t\tfloat variance = distribution.y * distribution.y;\n\t\t\t\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\t\tfloat hard_shadow = step( mean, shadowCoord.z );\n\t\t\t\t#else\n\t\t\t\t\tfloat hard_shadow = step( shadowCoord.z, mean );\n\t\t\t\t#endif\n\t\t\t\t\n\t\t\t\tif ( hard_shadow == 1.0 ) {\n\t\t\t\t\tshadow = 1.0;\n\t\t\t\t} else {\n\t\t\t\t\tvariance = max( variance, 0.0000001 );\n\t\t\t\t\tfloat d = shadowCoord.z - mean;\n\t\t\t\t\tfloat p_max = variance / ( variance + d * d );\n\t\t\t\t\tp_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );\n\t\t\t\t\tshadow = max( hard_shadow, p_max );\n\t\t\t\t}\n\t\t\t}\n\t\t\treturn mix( 1.0, shadow, shadowIntensity );\n\t\t}\n\t#else\n\t\tfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n\t\t\tfloat shadow = 1.0;\n\t\t\tshadowCoord.xyz /= shadowCoord.w;\n\t\t\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\tshadowCoord.z -= shadowBias;\n\t\t\t#else\n\t\t\t\tshadowCoord.z += shadowBias;\n\t\t\t#endif\n\t\t\tbool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;\n\t\t\tbool frustumTest = inFrustum && shadowCoord.z <= 1.0;\n\t\t\tif ( frustumTest ) {\n\t\t\t\tfloat depth = texture2D( shadowMap, shadowCoord.xy ).r;\n\t\t\t\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\t\tshadow = step( depth, shadowCoord.z );\n\t\t\t\t#else\n\t\t\t\t\tshadow = step( shadowCoord.z, depth );\n\t\t\t\t#endif\n\t\t\t}\n\t\t\treturn mix( 1.0, shadow, shadowIntensity );\n\t\t}\n\t#endif\n\t#if NUM_POINT_LIGHT_SHADOWS > 0\n\t#if defined( SHADOWMAP_TYPE_PCF )\n\tfloat getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {\n\t\tfloat shadow = 1.0;\n\t\tvec3 lightToPosition = shadowCoord.xyz;\n\t\tvec3 bd3D = normalize( lightToPosition );\n\t\tvec3 absVec = abs( lightToPosition );\n\t\tfloat viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );\n\t\tif ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {\n\t\t\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\tfloat dp = ( shadowCameraNear * ( shadowCameraFar - viewSpaceZ ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );\n\t\t\t\tdp -= shadowBias;\n\t\t\t#else\n\t\t\t\tfloat dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );\n\t\t\t\tdp += shadowBias;\n\t\t\t#endif\n\t\t\tfloat texelSize = shadowRadius / shadowMapSize.x;\n\t\t\tvec3 absDir = abs( bd3D );\n\t\t\tvec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );\n\t\t\ttangent = normalize( cross( bd3D, tangent ) );\n\t\t\tvec3 bitangent = cross( bd3D, tangent );\n\t\t\tfloat phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;\n\t\t\tvec2 sample0 = vogelDiskSample( 0, 5, phi );\n\t\t\tvec2 sample1 = vogelDiskSample( 1, 5, phi );\n\t\t\tvec2 sample2 = vogelDiskSample( 2, 5, phi );\n\t\t\tvec2 sample3 = vogelDiskSample( 3, 5, phi );\n\t\t\tvec2 sample4 = vogelDiskSample( 4, 5, phi );\n\t\t\tshadow = (\n\t\t\t\ttexture( shadowMap, vec4( bd3D + ( tangent * sample0.x + bitangent * sample0.y ) * texelSize, dp ) ) +\n\t\t\t\ttexture( shadowMap, vec4( bd3D + ( tangent * sample1.x + bitangent * sample1.y ) * texelSize, dp ) ) +\n\t\t\t\ttexture( shadowMap, vec4( bd3D + ( tangent * sample2.x + bitangent * sample2.y ) * texelSize, dp ) ) +\n\t\t\t\ttexture( shadowMap, vec4( bd3D + ( tangent * sample3.x + bitangent * sample3.y ) * texelSize, dp ) ) +\n\t\t\t\ttexture( shadowMap, vec4( bd3D + ( tangent * sample4.x + bitangent * sample4.y ) * texelSize, dp ) )\n\t\t\t) * 0.2;\n\t\t}\n\t\treturn mix( 1.0, shadow, shadowIntensity );\n\t}\n\t#elif defined( SHADOWMAP_TYPE_BASIC )\n\tfloat getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {\n\t\tfloat shadow = 1.0;\n\t\tvec3 lightToPosition = shadowCoord.xyz;\n\t\tvec3 absVec = abs( lightToPosition );\n\t\tfloat viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );\n\t\tif ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {\n\t\t\tfloat dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );\n\t\t\tdp += shadowBias;\n\t\t\tvec3 bd3D = normalize( lightToPosition );\n\t\t\tfloat depth = textureCube( shadowMap, bd3D ).r;\n\t\t\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\t\t\tdepth = 1.0 - depth;\n\t\t\t#endif\n\t\t\tshadow = step( dp, depth );\n\t\t}\n\t\treturn mix( 1.0, shadow, shadowIntensity );\n\t}\n\t#endif\n\t#endif\n#endif",
        shadowmap_pars_vertex: "#if NUM_SPOT_LIGHT_COORDS > 0\n\tuniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];\n\tvarying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];\n#endif\n#ifdef USE_SHADOWMAP\n\t#if NUM_DIR_LIGHT_SHADOWS > 0\n\t\tuniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];\n\t\tvarying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];\n\t\tstruct DirectionalLightShadow {\n\t\t\tfloat shadowIntensity;\n\t\t\tfloat shadowBias;\n\t\t\tfloat shadowNormalBias;\n\t\t\tfloat shadowRadius;\n\t\t\tvec2 shadowMapSize;\n\t\t};\n\t\tuniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];\n\t#endif\n\t#if NUM_SPOT_LIGHT_SHADOWS > 0\n\t\tstruct SpotLightShadow {\n\t\t\tfloat shadowIntensity;\n\t\t\tfloat shadowBias;\n\t\t\tfloat shadowNormalBias;\n\t\t\tfloat shadowRadius;\n\t\t\tvec2 shadowMapSize;\n\t\t};\n\t\tuniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];\n\t#endif\n\t#if NUM_POINT_LIGHT_SHADOWS > 0\n\t\tuniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];\n\t\tvarying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];\n\t\tstruct PointLightShadow {\n\t\t\tfloat shadowIntensity;\n\t\t\tfloat shadowBias;\n\t\t\tfloat shadowNormalBias;\n\t\t\tfloat shadowRadius;\n\t\t\tvec2 shadowMapSize;\n\t\t\tfloat shadowCameraNear;\n\t\t\tfloat shadowCameraFar;\n\t\t};\n\t\tuniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];\n\t#endif\n#endif",
        shadowmap_vertex: "#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )\n\tvec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );\n\tvec4 shadowWorldPosition;\n#endif\n#if defined( USE_SHADOWMAP )\n\t#if NUM_DIR_LIGHT_SHADOWS > 0\n\t\t#pragma unroll_loop_start\n\t\tfor ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {\n\t\t\tshadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );\n\t\t\tvDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;\n\t\t}\n\t\t#pragma unroll_loop_end\n\t#endif\n\t#if NUM_POINT_LIGHT_SHADOWS > 0\n\t\t#pragma unroll_loop_start\n\t\tfor ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {\n\t\t\tshadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );\n\t\t\tvPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;\n\t\t}\n\t\t#pragma unroll_loop_end\n\t#endif\n#endif\n#if NUM_SPOT_LIGHT_COORDS > 0\n\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {\n\t\tshadowWorldPosition = worldPosition;\n\t\t#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )\n\t\t\tshadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;\n\t\t#endif\n\t\tvSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;\n\t}\n\t#pragma unroll_loop_end\n#endif",
        shadowmask_pars_fragment: "float getShadowMask() {\n\tfloat shadow = 1.0;\n\t#ifdef USE_SHADOWMAP\n\t#if NUM_DIR_LIGHT_SHADOWS > 0\n\tDirectionalLightShadow directionalLight;\n\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {\n\t\tdirectionalLight = directionalLightShadows[ i ];\n\t\tshadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;\n\t}\n\t#pragma unroll_loop_end\n\t#endif\n\t#if NUM_SPOT_LIGHT_SHADOWS > 0\n\tSpotLightShadow spotLight;\n\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {\n\t\tspotLight = spotLightShadows[ i ];\n\t\tshadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;\n\t}\n\t#pragma unroll_loop_end\n\t#endif\n\t#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )\n\tPointLightShadow pointLight;\n\t#pragma unroll_loop_start\n\tfor ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {\n\t\tpointLight = pointLightShadows[ i ];\n\t\tshadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;\n\t}\n\t#pragma unroll_loop_end\n\t#endif\n\t#endif\n\treturn shadow;\n}",
        skinbase_vertex: "#ifdef USE_SKINNING\n\tmat4 boneMatX = getBoneMatrix( skinIndex.x );\n\tmat4 boneMatY = getBoneMatrix( skinIndex.y );\n\tmat4 boneMatZ = getBoneMatrix( skinIndex.z );\n\tmat4 boneMatW = getBoneMatrix( skinIndex.w );\n#endif",
        skinning_pars_vertex: "#ifdef USE_SKINNING\n\tuniform mat4 bindMatrix;\n\tuniform mat4 bindMatrixInverse;\n\tuniform highp sampler2D boneTexture;\n\tmat4 getBoneMatrix( const in float i ) {\n\t\tint size = textureSize( boneTexture, 0 ).x;\n\t\tint j = int( i ) * 4;\n\t\tint x = j % size;\n\t\tint y = j / size;\n\t\tvec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );\n\t\tvec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );\n\t\tvec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );\n\t\tvec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );\n\t\treturn mat4( v1, v2, v3, v4 );\n\t}\n#endif",
        skinning_vertex: "#ifdef USE_SKINNING\n\tvec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );\n\tvec4 skinned = vec4( 0.0 );\n\tskinned += boneMatX * skinVertex * skinWeight.x;\n\tskinned += boneMatY * skinVertex * skinWeight.y;\n\tskinned += boneMatZ * skinVertex * skinWeight.z;\n\tskinned += boneMatW * skinVertex * skinWeight.w;\n\ttransformed = ( bindMatrixInverse * skinned ).xyz;\n#endif",
        skinnormal_vertex: "#ifdef USE_SKINNING\n\tmat4 skinMatrix = mat4( 0.0 );\n\tskinMatrix += skinWeight.x * boneMatX;\n\tskinMatrix += skinWeight.y * boneMatY;\n\tskinMatrix += skinWeight.z * boneMatZ;\n\tskinMatrix += skinWeight.w * boneMatW;\n\tskinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;\n\tobjectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;\n\t#ifdef USE_TANGENT\n\t\tobjectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;\n\t#endif\n#endif",
        specularmap_fragment: "float specularStrength;\n#ifdef USE_SPECULARMAP\n\tvec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );\n\tspecularStrength = texelSpecular.r;\n#else\n\tspecularStrength = 1.0;\n#endif",
        specularmap_pars_fragment: "#ifdef USE_SPECULARMAP\n\tuniform sampler2D specularMap;\n#endif",
        tonemapping_fragment: "#if defined( TONE_MAPPING )\n\tgl_FragColor.rgb = toneMapping( gl_FragColor.rgb );\n#endif",
        tonemapping_pars_fragment: "#ifndef saturate\n#define saturate( a ) clamp( a, 0.0, 1.0 )\n#endif\nuniform float toneMappingExposure;\nvec3 LinearToneMapping( vec3 color ) {\n\treturn saturate( toneMappingExposure * color );\n}\nvec3 ReinhardToneMapping( vec3 color ) {\n\tcolor *= toneMappingExposure;\n\treturn saturate( color / ( vec3( 1.0 ) + color ) );\n}\nvec3 CineonToneMapping( vec3 color ) {\n\tcolor *= toneMappingExposure;\n\tcolor = max( vec3( 0.0 ), color - 0.004 );\n\treturn pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );\n}\nvec3 RRTAndODTFit( vec3 v ) {\n\tvec3 a = v * ( v + 0.0245786 ) - 0.000090537;\n\tvec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;\n\treturn a / b;\n}\nvec3 ACESFilmicToneMapping( vec3 color ) {\n\tconst mat3 ACESInputMat = mat3(\n\t\tvec3( 0.59719, 0.07600, 0.02840 ),\t\tvec3( 0.35458, 0.90834, 0.13383 ),\n\t\tvec3( 0.04823, 0.01566, 0.83777 )\n\t);\n\tconst mat3 ACESOutputMat = mat3(\n\t\tvec3(  1.60475, -0.10208, -0.00327 ),\t\tvec3( -0.53108,  1.10813, -0.07276 ),\n\t\tvec3( -0.07367, -0.00605,  1.07602 )\n\t);\n\tcolor *= toneMappingExposure / 0.6;\n\tcolor = ACESInputMat * color;\n\tcolor = RRTAndODTFit( color );\n\tcolor = ACESOutputMat * color;\n\treturn saturate( color );\n}\nconst mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(\n\tvec3( 1.6605, - 0.1246, - 0.0182 ),\n\tvec3( - 0.5876, 1.1329, - 0.1006 ),\n\tvec3( - 0.0728, - 0.0083, 1.1187 )\n);\nconst mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(\n\tvec3( 0.6274, 0.0691, 0.0164 ),\n\tvec3( 0.3293, 0.9195, 0.0880 ),\n\tvec3( 0.0433, 0.0113, 0.8956 )\n);\nvec3 agxDefaultContrastApprox( vec3 x ) {\n\tvec3 x2 = x * x;\n\tvec3 x4 = x2 * x2;\n\treturn + 15.5 * x4 * x2\n\t\t- 40.14 * x4 * x\n\t\t+ 31.96 * x4\n\t\t- 6.868 * x2 * x\n\t\t+ 0.4298 * x2\n\t\t+ 0.1191 * x\n\t\t- 0.00232;\n}\nvec3 AgXToneMapping( vec3 color ) {\n\tconst mat3 AgXInsetMatrix = mat3(\n\t\tvec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),\n\t\tvec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),\n\t\tvec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )\n\t);\n\tconst mat3 AgXOutsetMatrix = mat3(\n\t\tvec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),\n\t\tvec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),\n\t\tvec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )\n\t);\n\tconst float AgxMinEv = - 12.47393;\tconst float AgxMaxEv = 4.026069;\n\tcolor *= toneMappingExposure;\n\tcolor = LINEAR_SRGB_TO_LINEAR_REC2020 * color;\n\tcolor = AgXInsetMatrix * color;\n\tcolor = max( color, 1e-10 );\tcolor = log2( color );\n\tcolor = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );\n\tcolor = clamp( color, 0.0, 1.0 );\n\tcolor = agxDefaultContrastApprox( color );\n\tcolor = AgXOutsetMatrix * color;\n\tcolor = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );\n\tcolor = LINEAR_REC2020_TO_LINEAR_SRGB * color;\n\tcolor = clamp( color, 0.0, 1.0 );\n\treturn color;\n}\nvec3 NeutralToneMapping( vec3 color ) {\n\tconst float StartCompression = 0.8 - 0.04;\n\tconst float Desaturation = 0.15;\n\tcolor *= toneMappingExposure;\n\tfloat x = min( color.r, min( color.g, color.b ) );\n\tfloat offset = x < 0.08 ? x - 6.25 * x * x : 0.04;\n\tcolor -= offset;\n\tfloat peak = max( color.r, max( color.g, color.b ) );\n\tif ( peak < StartCompression ) return color;\n\tfloat d = 1. - StartCompression;\n\tfloat newPeak = 1. - d * d / ( peak + d - StartCompression );\n\tcolor *= newPeak / peak;\n\tfloat g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );\n\treturn mix( color, vec3( newPeak ), g );\n}\nvec3 CustomToneMapping( vec3 color ) { return color; }",
        transmission_fragment: "#ifdef USE_TRANSMISSION\n\tmaterial.transmission = transmission;\n\tmaterial.transmissionAlpha = 1.0;\n\tmaterial.thickness = thickness;\n\tmaterial.attenuationDistance = attenuationDistance;\n\tmaterial.attenuationColor = attenuationColor;\n\t#ifdef USE_TRANSMISSIONMAP\n\t\tmaterial.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;\n\t#endif\n\t#ifdef USE_THICKNESSMAP\n\t\tmaterial.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;\n\t#endif\n\tvec3 pos = vWorldPosition;\n\tvec3 v = normalize( cameraPosition - pos );\n\tvec3 n = inverseTransformDirection( normal, viewMatrix );\n\tvec4 transmitted = getIBLVolumeRefraction(\n\t\tn, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,\n\t\tpos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,\n\t\tmaterial.attenuationColor, material.attenuationDistance );\n\tmaterial.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );\n\ttotalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );\n#endif",
        transmission_pars_fragment: "#ifdef USE_TRANSMISSION\n\tuniform float transmission;\n\tuniform float thickness;\n\tuniform float attenuationDistance;\n\tuniform vec3 attenuationColor;\n\t#ifdef USE_TRANSMISSIONMAP\n\t\tuniform sampler2D transmissionMap;\n\t#endif\n\t#ifdef USE_THICKNESSMAP\n\t\tuniform sampler2D thicknessMap;\n\t#endif\n\tuniform vec2 transmissionSamplerSize;\n\tuniform sampler2D transmissionSamplerMap;\n\tuniform mat4 modelMatrix;\n\tuniform mat4 projectionMatrix;\n\tvarying vec3 vWorldPosition;\n\tfloat w0( float a ) {\n\t\treturn ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );\n\t}\n\tfloat w1( float a ) {\n\t\treturn ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );\n\t}\n\tfloat w2( float a ){\n\t\treturn ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );\n\t}\n\tfloat w3( float a ) {\n\t\treturn ( 1.0 / 6.0 ) * ( a * a * a );\n\t}\n\tfloat g0( float a ) {\n\t\treturn w0( a ) + w1( a );\n\t}\n\tfloat g1( float a ) {\n\t\treturn w2( a ) + w3( a );\n\t}\n\tfloat h0( float a ) {\n\t\treturn - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );\n\t}\n\tfloat h1( float a ) {\n\t\treturn 1.0 + w3( a ) / ( w2( a ) + w3( a ) );\n\t}\n\tvec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {\n\t\tuv = uv * texelSize.zw + 0.5;\n\t\tvec2 iuv = floor( uv );\n\t\tvec2 fuv = fract( uv );\n\t\tfloat g0x = g0( fuv.x );\n\t\tfloat g1x = g1( fuv.x );\n\t\tfloat h0x = h0( fuv.x );\n\t\tfloat h1x = h1( fuv.x );\n\t\tfloat h0y = h0( fuv.y );\n\t\tfloat h1y = h1( fuv.y );\n\t\tvec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;\n\t\tvec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;\n\t\tvec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;\n\t\tvec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;\n\t\treturn g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +\n\t\t\tg1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );\n\t}\n\tvec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {\n\t\tvec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );\n\t\tvec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );\n\t\tvec2 fLodSizeInv = 1.0 / fLodSize;\n\t\tvec2 cLodSizeInv = 1.0 / cLodSize;\n\t\tvec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );\n\t\tvec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );\n\t\treturn mix( fSample, cSample, fract( lod ) );\n\t}\n\tvec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {\n\t\tvec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );\n\t\tvec3 modelScale;\n\t\tmodelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );\n\t\tmodelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );\n\t\tmodelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );\n\t\treturn normalize( refractionVector ) * thickness * modelScale;\n\t}\n\tfloat applyIorToRoughness( const in float roughness, const in float ior ) {\n\t\treturn roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );\n\t}\n\tvec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {\n\t\tfloat lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );\n\t\treturn textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );\n\t}\n\tvec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {\n\t\tif ( isinf( attenuationDistance ) ) {\n\t\t\treturn vec3( 1.0 );\n\t\t} else {\n\t\t\tvec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;\n\t\t\tvec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );\t\t\treturn transmittance;\n\t\t}\n\t}\n\tvec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,\n\t\tconst in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,\n\t\tconst in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,\n\t\tconst in vec3 attenuationColor, const in float attenuationDistance ) {\n\t\tvec4 transmittedLight;\n\t\tvec3 transmittance;\n\t\t#ifdef USE_DISPERSION\n\t\t\tfloat halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;\n\t\t\tvec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );\n\t\t\tfor ( int i = 0; i < 3; i ++ ) {\n\t\t\t\tvec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );\n\t\t\t\tvec3 refractedRayExit = position + transmissionRay;\n\t\t\t\tvec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );\n\t\t\t\tvec2 refractionCoords = ndcPos.xy / ndcPos.w;\n\t\t\t\trefractionCoords += 1.0;\n\t\t\t\trefractionCoords /= 2.0;\n\t\t\t\tvec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );\n\t\t\t\ttransmittedLight[ i ] = transmissionSample[ i ];\n\t\t\t\ttransmittedLight.a += transmissionSample.a;\n\t\t\t\ttransmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];\n\t\t\t}\n\t\t\ttransmittedLight.a /= 3.0;\n\t\t#else\n\t\t\tvec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );\n\t\t\tvec3 refractedRayExit = position + transmissionRay;\n\t\t\tvec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );\n\t\t\tvec2 refractionCoords = ndcPos.xy / ndcPos.w;\n\t\t\trefractionCoords += 1.0;\n\t\t\trefractionCoords /= 2.0;\n\t\t\ttransmittedLight = getTransmissionSample( refractionCoords, roughness, ior );\n\t\t\ttransmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );\n\t\t#endif\n\t\tvec3 attenuatedColor = transmittance * transmittedLight.rgb;\n\t\tvec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );\n\t\tfloat transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;\n\t\treturn vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );\n\t}\n#endif",
        uv_pars_fragment: "#if defined( USE_UV ) || defined( USE_ANISOTROPY )\n\tvarying vec2 vUv;\n#endif\n#ifdef USE_MAP\n\tvarying vec2 vMapUv;\n#endif\n#ifdef USE_ALPHAMAP\n\tvarying vec2 vAlphaMapUv;\n#endif\n#ifdef USE_LIGHTMAP\n\tvarying vec2 vLightMapUv;\n#endif\n#ifdef USE_AOMAP\n\tvarying vec2 vAoMapUv;\n#endif\n#ifdef USE_BUMPMAP\n\tvarying vec2 vBumpMapUv;\n#endif\n#ifdef USE_NORMALMAP\n\tvarying vec2 vNormalMapUv;\n#endif\n#ifdef USE_EMISSIVEMAP\n\tvarying vec2 vEmissiveMapUv;\n#endif\n#ifdef USE_METALNESSMAP\n\tvarying vec2 vMetalnessMapUv;\n#endif\n#ifdef USE_ROUGHNESSMAP\n\tvarying vec2 vRoughnessMapUv;\n#endif\n#ifdef USE_ANISOTROPYMAP\n\tvarying vec2 vAnisotropyMapUv;\n#endif\n#ifdef USE_CLEARCOATMAP\n\tvarying vec2 vClearcoatMapUv;\n#endif\n#ifdef USE_CLEARCOAT_NORMALMAP\n\tvarying vec2 vClearcoatNormalMapUv;\n#endif\n#ifdef USE_CLEARCOAT_ROUGHNESSMAP\n\tvarying vec2 vClearcoatRoughnessMapUv;\n#endif\n#ifdef USE_IRIDESCENCEMAP\n\tvarying vec2 vIridescenceMapUv;\n#endif\n#ifdef USE_IRIDESCENCE_THICKNESSMAP\n\tvarying vec2 vIridescenceThicknessMapUv;\n#endif\n#ifdef USE_SHEEN_COLORMAP\n\tvarying vec2 vSheenColorMapUv;\n#endif\n#ifdef USE_SHEEN_ROUGHNESSMAP\n\tvarying vec2 vSheenRoughnessMapUv;\n#endif\n#ifdef USE_SPECULARMAP\n\tvarying vec2 vSpecularMapUv;\n#endif\n#ifdef USE_SPECULAR_COLORMAP\n\tvarying vec2 vSpecularColorMapUv;\n#endif\n#ifdef USE_SPECULAR_INTENSITYMAP\n\tvarying vec2 vSpecularIntensityMapUv;\n#endif\n#ifdef USE_TRANSMISSIONMAP\n\tuniform mat3 transmissionMapTransform;\n\tvarying vec2 vTransmissionMapUv;\n#endif\n#ifdef USE_THICKNESSMAP\n\tuniform mat3 thicknessMapTransform;\n\tvarying vec2 vThicknessMapUv;\n#endif",
        uv_pars_vertex: "#if defined( USE_UV ) || defined( USE_ANISOTROPY )\n\tvarying vec2 vUv;\n#endif\n#ifdef USE_MAP\n\tuniform mat3 mapTransform;\n\tvarying vec2 vMapUv;\n#endif\n#ifdef USE_ALPHAMAP\n\tuniform mat3 alphaMapTransform;\n\tvarying vec2 vAlphaMapUv;\n#endif\n#ifdef USE_LIGHTMAP\n\tuniform mat3 lightMapTransform;\n\tvarying vec2 vLightMapUv;\n#endif\n#ifdef USE_AOMAP\n\tuniform mat3 aoMapTransform;\n\tvarying vec2 vAoMapUv;\n#endif\n#ifdef USE_BUMPMAP\n\tuniform mat3 bumpMapTransform;\n\tvarying vec2 vBumpMapUv;\n#endif\n#ifdef USE_NORMALMAP\n\tuniform mat3 normalMapTransform;\n\tvarying vec2 vNormalMapUv;\n#endif\n#ifdef USE_DISPLACEMENTMAP\n\tuniform mat3 displacementMapTransform;\n\tvarying vec2 vDisplacementMapUv;\n#endif\n#ifdef USE_EMISSIVEMAP\n\tuniform mat3 emissiveMapTransform;\n\tvarying vec2 vEmissiveMapUv;\n#endif\n#ifdef USE_METALNESSMAP\n\tuniform mat3 metalnessMapTransform;\n\tvarying vec2 vMetalnessMapUv;\n#endif\n#ifdef USE_ROUGHNESSMAP\n\tuniform mat3 roughnessMapTransform;\n\tvarying vec2 vRoughnessMapUv;\n#endif\n#ifdef USE_ANISOTROPYMAP\n\tuniform mat3 anisotropyMapTransform;\n\tvarying vec2 vAnisotropyMapUv;\n#endif\n#ifdef USE_CLEARCOATMAP\n\tuniform mat3 clearcoatMapTransform;\n\tvarying vec2 vClearcoatMapUv;\n#endif\n#ifdef USE_CLEARCOAT_NORMALMAP\n\tuniform mat3 clearcoatNormalMapTransform;\n\tvarying vec2 vClearcoatNormalMapUv;\n#endif\n#ifdef USE_CLEARCOAT_ROUGHNESSMAP\n\tuniform mat3 clearcoatRoughnessMapTransform;\n\tvarying vec2 vClearcoatRoughnessMapUv;\n#endif\n#ifdef USE_SHEEN_COLORMAP\n\tuniform mat3 sheenColorMapTransform;\n\tvarying vec2 vSheenColorMapUv;\n#endif\n#ifdef USE_SHEEN_ROUGHNESSMAP\n\tuniform mat3 sheenRoughnessMapTransform;\n\tvarying vec2 vSheenRoughnessMapUv;\n#endif\n#ifdef USE_IRIDESCENCEMAP\n\tuniform mat3 iridescenceMapTransform;\n\tvarying vec2 vIridescenceMapUv;\n#endif\n#ifdef USE_IRIDESCENCE_THICKNESSMAP\n\tuniform mat3 iridescenceThicknessMapTransform;\n\tvarying vec2 vIridescenceThicknessMapUv;\n#endif\n#ifdef USE_SPECULARMAP\n\tuniform mat3 specularMapTransform;\n\tvarying vec2 vSpecularMapUv;\n#endif\n#ifdef USE_SPECULAR_COLORMAP\n\tuniform mat3 specularColorMapTransform;\n\tvarying vec2 vSpecularColorMapUv;\n#endif\n#ifdef USE_SPECULAR_INTENSITYMAP\n\tuniform mat3 specularIntensityMapTransform;\n\tvarying vec2 vSpecularIntensityMapUv;\n#endif\n#ifdef USE_TRANSMISSIONMAP\n\tuniform mat3 transmissionMapTransform;\n\tvarying vec2 vTransmissionMapUv;\n#endif\n#ifdef USE_THICKNESSMAP\n\tuniform mat3 thicknessMapTransform;\n\tvarying vec2 vThicknessMapUv;\n#endif",
        uv_vertex: "#if defined( USE_UV ) || defined( USE_ANISOTROPY )\n\tvUv = vec3( uv, 1 ).xy;\n#endif\n#ifdef USE_MAP\n\tvMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_ALPHAMAP\n\tvAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_LIGHTMAP\n\tvLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_AOMAP\n\tvAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_BUMPMAP\n\tvBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_NORMALMAP\n\tvNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_DISPLACEMENTMAP\n\tvDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_EMISSIVEMAP\n\tvEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_METALNESSMAP\n\tvMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_ROUGHNESSMAP\n\tvRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_ANISOTROPYMAP\n\tvAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_CLEARCOATMAP\n\tvClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_CLEARCOAT_NORMALMAP\n\tvClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_CLEARCOAT_ROUGHNESSMAP\n\tvClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_IRIDESCENCEMAP\n\tvIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_IRIDESCENCE_THICKNESSMAP\n\tvIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_SHEEN_COLORMAP\n\tvSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_SHEEN_ROUGHNESSMAP\n\tvSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_SPECULARMAP\n\tvSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_SPECULAR_COLORMAP\n\tvSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_SPECULAR_INTENSITYMAP\n\tvSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_TRANSMISSIONMAP\n\tvTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;\n#endif\n#ifdef USE_THICKNESSMAP\n\tvThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;\n#endif",
        worldpos_vertex: "#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0\n\tvec4 worldPosition = vec4( transformed, 1.0 );\n\t#ifdef USE_BATCHING\n\t\tworldPosition = batchingMatrix * worldPosition;\n\t#endif\n\t#ifdef USE_INSTANCING\n\t\tworldPosition = instanceMatrix * worldPosition;\n\t#endif\n\tworldPosition = modelMatrix * worldPosition;\n#endif",
        background_vert: "varying vec2 vUv;\nuniform mat3 uvTransform;\nvoid main() {\n\tvUv = ( uvTransform * vec3( uv, 1 ) ).xy;\n\tgl_Position = vec4( position.xy, 1.0, 1.0 );\n}",
        background_frag: "uniform sampler2D t2D;\nuniform float backgroundIntensity;\nvarying vec2 vUv;\nvoid main() {\n\tvec4 texColor = texture2D( t2D, vUv );\n\t#ifdef DECODE_VIDEO_TEXTURE\n\t\ttexColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );\n\t#endif\n\ttexColor.rgb *= backgroundIntensity;\n\tgl_FragColor = texColor;\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n}",
        backgroundCube_vert: "varying vec3 vWorldDirection;\n#include <common>\nvoid main() {\n\tvWorldDirection = transformDirection( position, modelMatrix );\n\t#include <begin_vertex>\n\t#include <project_vertex>\n\tgl_Position.z = gl_Position.w;\n}",
        backgroundCube_frag: "#ifdef ENVMAP_TYPE_CUBE\n\tuniform samplerCube envMap;\n#elif defined( ENVMAP_TYPE_CUBE_UV )\n\tuniform sampler2D envMap;\n#endif\nuniform float flipEnvMap;\nuniform float backgroundBlurriness;\nuniform float backgroundIntensity;\nuniform mat3 backgroundRotation;\nvarying vec3 vWorldDirection;\n#include <cube_uv_reflection_fragment>\nvoid main() {\n\t#ifdef ENVMAP_TYPE_CUBE\n\t\tvec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );\n\t#elif defined( ENVMAP_TYPE_CUBE_UV )\n\t\tvec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );\n\t#else\n\t\tvec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );\n\t#endif\n\ttexColor.rgb *= backgroundIntensity;\n\tgl_FragColor = texColor;\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n}",
        cube_vert: "varying vec3 vWorldDirection;\n#include <common>\nvoid main() {\n\tvWorldDirection = transformDirection( position, modelMatrix );\n\t#include <begin_vertex>\n\t#include <project_vertex>\n\tgl_Position.z = gl_Position.w;\n}",
        cube_frag: "uniform samplerCube tCube;\nuniform float tFlip;\nuniform float opacity;\nvarying vec3 vWorldDirection;\nvoid main() {\n\tvec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );\n\tgl_FragColor = texColor;\n\tgl_FragColor.a *= opacity;\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n}",
        depth_vert: "#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <displacementmap_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvarying vec2 vHighPrecisionZW;\nvoid main() {\n\t#include <uv_vertex>\n\t#include <batching_vertex>\n\t#include <skinbase_vertex>\n\t#include <morphinstance_vertex>\n\t#ifdef USE_DISPLACEMENTMAP\n\t\t#include <beginnormal_vertex>\n\t\t#include <morphnormal_vertex>\n\t\t#include <skinnormal_vertex>\n\t#endif\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <displacementmap_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\tvHighPrecisionZW = gl_Position.zw;\n}",
        depth_frag: "#if DEPTH_PACKING == 3200\n\tuniform float opacity;\n#endif\n#include <common>\n#include <packing>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvarying vec2 vHighPrecisionZW;\nvoid main() {\n\tvec4 diffuseColor = vec4( 1.0 );\n\t#include <clipping_planes_fragment>\n\t#if DEPTH_PACKING == 3200\n\t\tdiffuseColor.a = opacity;\n\t#endif\n\t#include <map_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\t#include <logdepthbuf_fragment>\n\t#ifdef USE_REVERSED_DEPTH_BUFFER\n\t\tfloat fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];\n\t#else\n\t\tfloat fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;\n\t#endif\n\t#if DEPTH_PACKING == 3200\n\t\tgl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );\n\t#elif DEPTH_PACKING == 3201\n\t\tgl_FragColor = packDepthToRGBA( fragCoordZ );\n\t#elif DEPTH_PACKING == 3202\n\t\tgl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );\n\t#elif DEPTH_PACKING == 3203\n\t\tgl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );\n\t#endif\n}",
        distance_vert: "#define DISTANCE\nvarying vec3 vWorldPosition;\n#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <displacementmap_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <batching_vertex>\n\t#include <skinbase_vertex>\n\t#include <morphinstance_vertex>\n\t#ifdef USE_DISPLACEMENTMAP\n\t\t#include <beginnormal_vertex>\n\t\t#include <morphnormal_vertex>\n\t\t#include <skinnormal_vertex>\n\t#endif\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <displacementmap_vertex>\n\t#include <project_vertex>\n\t#include <worldpos_vertex>\n\t#include <clipping_planes_vertex>\n\tvWorldPosition = worldPosition.xyz;\n}",
        distance_frag: "#define DISTANCE\nuniform vec3 referencePosition;\nuniform float nearDistance;\nuniform float farDistance;\nvarying vec3 vWorldPosition;\n#include <common>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main () {\n\tvec4 diffuseColor = vec4( 1.0 );\n\t#include <clipping_planes_fragment>\n\t#include <map_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\tfloat dist = length( vWorldPosition - referencePosition );\n\tdist = ( dist - nearDistance ) / ( farDistance - nearDistance );\n\tdist = saturate( dist );\n\tgl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );\n}",
        equirect_vert: "varying vec3 vWorldDirection;\n#include <common>\nvoid main() {\n\tvWorldDirection = transformDirection( position, modelMatrix );\n\t#include <begin_vertex>\n\t#include <project_vertex>\n}",
        equirect_frag: "uniform sampler2D tEquirect;\nvarying vec3 vWorldDirection;\n#include <common>\nvoid main() {\n\tvec3 direction = normalize( vWorldDirection );\n\tvec2 sampleUV = equirectUv( direction );\n\tgl_FragColor = texture2D( tEquirect, sampleUV );\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n}",
        linedashed_vert: "uniform float scale;\nattribute float lineDistance;\nvarying float vLineDistance;\n#include <common>\n#include <uv_pars_vertex>\n#include <color_pars_vertex>\n#include <fog_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\tvLineDistance = scale * lineDistance;\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphcolor_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\t#include <fog_vertex>\n}",
        linedashed_frag: "uniform vec3 diffuse;\nuniform float opacity;\nuniform float dashSize;\nuniform float totalSize;\nvarying float vLineDistance;\n#include <common>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <fog_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\tif ( mod( vLineDistance, totalSize ) > dashSize ) {\n\t\tdiscard;\n\t}\n\tvec3 outgoingLight = vec3( 0.0 );\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <color_fragment>\n\toutgoingLight = diffuseColor.rgb;\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n}",
        meshbasic_vert: "#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <envmap_pars_vertex>\n#include <color_pars_vertex>\n#include <fog_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphcolor_vertex>\n\t#include <batching_vertex>\n\t#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )\n\t\t#include <beginnormal_vertex>\n\t\t#include <morphnormal_vertex>\n\t\t#include <skinbase_vertex>\n\t\t#include <skinnormal_vertex>\n\t\t#include <defaultnormal_vertex>\n\t#endif\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\t#include <worldpos_vertex>\n\t#include <envmap_vertex>\n\t#include <fog_vertex>\n}",
        meshbasic_frag: "uniform vec3 diffuse;\nuniform float opacity;\n#ifndef FLAT_SHADED\n\tvarying vec3 vNormal;\n#endif\n#include <common>\n#include <dithering_pars_fragment>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <aomap_pars_fragment>\n#include <lightmap_pars_fragment>\n#include <envmap_common_pars_fragment>\n#include <envmap_pars_fragment>\n#include <fog_pars_fragment>\n#include <specularmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <color_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\t#include <specularmap_fragment>\n\tReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );\n\t#ifdef USE_LIGHTMAP\n\t\tvec4 lightMapTexel = texture2D( lightMap, vLightMapUv );\n\t\treflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;\n\t#else\n\t\treflectedLight.indirectDiffuse += vec3( 1.0 );\n\t#endif\n\t#include <aomap_fragment>\n\treflectedLight.indirectDiffuse *= diffuseColor.rgb;\n\tvec3 outgoingLight = reflectedLight.indirectDiffuse;\n\t#include <envmap_fragment>\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n\t#include <dithering_fragment>\n}",
        meshlambert_vert: "#define LAMBERT\nvarying vec3 vViewPosition;\n#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <displacementmap_pars_vertex>\n#include <envmap_pars_vertex>\n#include <color_pars_vertex>\n#include <fog_pars_vertex>\n#include <normal_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <shadowmap_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphcolor_vertex>\n\t#include <batching_vertex>\n\t#include <beginnormal_vertex>\n\t#include <morphnormal_vertex>\n\t#include <skinbase_vertex>\n\t#include <skinnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <normal_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <displacementmap_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\tvViewPosition = - mvPosition.xyz;\n\t#include <worldpos_vertex>\n\t#include <envmap_vertex>\n\t#include <shadowmap_vertex>\n\t#include <fog_vertex>\n}",
        meshlambert_frag: "#define LAMBERT\nuniform vec3 diffuse;\nuniform vec3 emissive;\nuniform float opacity;\n#include <common>\n#include <dithering_pars_fragment>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <aomap_pars_fragment>\n#include <lightmap_pars_fragment>\n#include <emissivemap_pars_fragment>\n#include <cube_uv_reflection_fragment>\n#include <envmap_common_pars_fragment>\n#include <envmap_pars_fragment>\n#include <envmap_physical_pars_fragment>\n#include <fog_pars_fragment>\n#include <bsdfs>\n#include <lights_pars_begin>\n#include <normal_pars_fragment>\n#include <lights_lambert_pars_fragment>\n#include <shadowmap_pars_fragment>\n#include <bumpmap_pars_fragment>\n#include <normalmap_pars_fragment>\n#include <specularmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\tReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );\n\tvec3 totalEmissiveRadiance = emissive;\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <color_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\t#include <specularmap_fragment>\n\t#include <normal_fragment_begin>\n\t#include <normal_fragment_maps>\n\t#include <emissivemap_fragment>\n\t#include <lights_lambert_fragment>\n\t#include <lights_fragment_begin>\n\t#include <lights_fragment_maps>\n\t#include <lights_fragment_end>\n\t#include <aomap_fragment>\n\tvec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;\n\t#include <envmap_fragment>\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n\t#include <dithering_fragment>\n}",
        meshmatcap_vert: "#define MATCAP\nvarying vec3 vViewPosition;\n#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <color_pars_vertex>\n#include <displacementmap_pars_vertex>\n#include <fog_pars_vertex>\n#include <normal_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphcolor_vertex>\n\t#include <batching_vertex>\n\t#include <beginnormal_vertex>\n\t#include <morphnormal_vertex>\n\t#include <skinbase_vertex>\n\t#include <skinnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <normal_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <displacementmap_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\t#include <fog_vertex>\n\tvViewPosition = - mvPosition.xyz;\n}",
        meshmatcap_frag: "#define MATCAP\nuniform vec3 diffuse;\nuniform float opacity;\nuniform sampler2D matcap;\nvarying vec3 vViewPosition;\n#include <common>\n#include <dithering_pars_fragment>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <fog_pars_fragment>\n#include <normal_pars_fragment>\n#include <bumpmap_pars_fragment>\n#include <normalmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <color_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\t#include <normal_fragment_begin>\n\t#include <normal_fragment_maps>\n\tvec3 viewDir = normalize( vViewPosition );\n\tvec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );\n\tvec3 y = cross( viewDir, x );\n\tvec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;\n\t#ifdef USE_MATCAP\n\t\tvec4 matcapColor = texture2D( matcap, uv );\n\t#else\n\t\tvec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );\n\t#endif\n\tvec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n\t#include <dithering_fragment>\n}",
        meshnormal_vert: "#define NORMAL\n#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )\n\tvarying vec3 vViewPosition;\n#endif\n#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <displacementmap_pars_vertex>\n#include <normal_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <batching_vertex>\n\t#include <beginnormal_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphnormal_vertex>\n\t#include <skinbase_vertex>\n\t#include <skinnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <normal_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <displacementmap_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )\n\tvViewPosition = - mvPosition.xyz;\n#endif\n}",
        meshnormal_frag: "#define NORMAL\nuniform float opacity;\n#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )\n\tvarying vec3 vViewPosition;\n#endif\n#include <uv_pars_fragment>\n#include <normal_pars_fragment>\n#include <bumpmap_pars_fragment>\n#include <normalmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );\n\t#include <clipping_planes_fragment>\n\t#include <logdepthbuf_fragment>\n\t#include <normal_fragment_begin>\n\t#include <normal_fragment_maps>\n\tgl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );\n\t#ifdef OPAQUE\n\t\tgl_FragColor.a = 1.0;\n\t#endif\n}",
        meshphong_vert: "#define PHONG\nvarying vec3 vViewPosition;\n#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <displacementmap_pars_vertex>\n#include <envmap_pars_vertex>\n#include <color_pars_vertex>\n#include <fog_pars_vertex>\n#include <normal_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <shadowmap_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphcolor_vertex>\n\t#include <batching_vertex>\n\t#include <beginnormal_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphnormal_vertex>\n\t#include <skinbase_vertex>\n\t#include <skinnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <normal_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <displacementmap_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\tvViewPosition = - mvPosition.xyz;\n\t#include <worldpos_vertex>\n\t#include <envmap_vertex>\n\t#include <shadowmap_vertex>\n\t#include <fog_vertex>\n}",
        meshphong_frag: "#define PHONG\nuniform vec3 diffuse;\nuniform vec3 emissive;\nuniform vec3 specular;\nuniform float shininess;\nuniform float opacity;\n#include <common>\n#include <dithering_pars_fragment>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <aomap_pars_fragment>\n#include <lightmap_pars_fragment>\n#include <emissivemap_pars_fragment>\n#include <cube_uv_reflection_fragment>\n#include <envmap_common_pars_fragment>\n#include <envmap_pars_fragment>\n#include <envmap_physical_pars_fragment>\n#include <fog_pars_fragment>\n#include <bsdfs>\n#include <lights_pars_begin>\n#include <normal_pars_fragment>\n#include <lights_phong_pars_fragment>\n#include <shadowmap_pars_fragment>\n#include <bumpmap_pars_fragment>\n#include <normalmap_pars_fragment>\n#include <specularmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\tReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );\n\tvec3 totalEmissiveRadiance = emissive;\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <color_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\t#include <specularmap_fragment>\n\t#include <normal_fragment_begin>\n\t#include <normal_fragment_maps>\n\t#include <emissivemap_fragment>\n\t#include <lights_phong_fragment>\n\t#include <lights_fragment_begin>\n\t#include <lights_fragment_maps>\n\t#include <lights_fragment_end>\n\t#include <aomap_fragment>\n\tvec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;\n\t#include <envmap_fragment>\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n\t#include <dithering_fragment>\n}",
        meshphysical_vert: "#define STANDARD\nvarying vec3 vViewPosition;\n#ifdef USE_TRANSMISSION\n\tvarying vec3 vWorldPosition;\n#endif\n#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <displacementmap_pars_vertex>\n#include <color_pars_vertex>\n#include <fog_pars_vertex>\n#include <normal_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <shadowmap_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphcolor_vertex>\n\t#include <batching_vertex>\n\t#include <beginnormal_vertex>\n\t#include <morphnormal_vertex>\n\t#include <skinbase_vertex>\n\t#include <skinnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <normal_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <displacementmap_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\tvViewPosition = - mvPosition.xyz;\n\t#include <worldpos_vertex>\n\t#include <shadowmap_vertex>\n\t#include <fog_vertex>\n#ifdef USE_TRANSMISSION\n\tvWorldPosition = worldPosition.xyz;\n#endif\n}",
        meshphysical_frag: "#define STANDARD\n#ifdef PHYSICAL\n\t#define IOR\n\t#define USE_SPECULAR\n#endif\nuniform vec3 diffuse;\nuniform vec3 emissive;\nuniform float roughness;\nuniform float metalness;\nuniform float opacity;\n#ifdef IOR\n\tuniform float ior;\n#endif\n#ifdef USE_SPECULAR\n\tuniform float specularIntensity;\n\tuniform vec3 specularColor;\n\t#ifdef USE_SPECULAR_COLORMAP\n\t\tuniform sampler2D specularColorMap;\n\t#endif\n\t#ifdef USE_SPECULAR_INTENSITYMAP\n\t\tuniform sampler2D specularIntensityMap;\n\t#endif\n#endif\n#ifdef USE_CLEARCOAT\n\tuniform float clearcoat;\n\tuniform float clearcoatRoughness;\n#endif\n#ifdef USE_DISPERSION\n\tuniform float dispersion;\n#endif\n#ifdef USE_IRIDESCENCE\n\tuniform float iridescence;\n\tuniform float iridescenceIOR;\n\tuniform float iridescenceThicknessMinimum;\n\tuniform float iridescenceThicknessMaximum;\n#endif\n#ifdef USE_SHEEN\n\tuniform vec3 sheenColor;\n\tuniform float sheenRoughness;\n\t#ifdef USE_SHEEN_COLORMAP\n\t\tuniform sampler2D sheenColorMap;\n\t#endif\n\t#ifdef USE_SHEEN_ROUGHNESSMAP\n\t\tuniform sampler2D sheenRoughnessMap;\n\t#endif\n#endif\n#ifdef USE_ANISOTROPY\n\tuniform vec2 anisotropyVector;\n\t#ifdef USE_ANISOTROPYMAP\n\t\tuniform sampler2D anisotropyMap;\n\t#endif\n#endif\nvarying vec3 vViewPosition;\n#include <common>\n#include <dithering_pars_fragment>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <aomap_pars_fragment>\n#include <lightmap_pars_fragment>\n#include <emissivemap_pars_fragment>\n#include <iridescence_fragment>\n#include <cube_uv_reflection_fragment>\n#include <envmap_common_pars_fragment>\n#include <envmap_physical_pars_fragment>\n#include <fog_pars_fragment>\n#include <lights_pars_begin>\n#include <normal_pars_fragment>\n#include <lights_physical_pars_fragment>\n#include <transmission_pars_fragment>\n#include <shadowmap_pars_fragment>\n#include <bumpmap_pars_fragment>\n#include <normalmap_pars_fragment>\n#include <clearcoat_pars_fragment>\n#include <iridescence_pars_fragment>\n#include <roughnessmap_pars_fragment>\n#include <metalnessmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\tReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );\n\tvec3 totalEmissiveRadiance = emissive;\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <color_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\t#include <roughnessmap_fragment>\n\t#include <metalnessmap_fragment>\n\t#include <normal_fragment_begin>\n\t#include <normal_fragment_maps>\n\t#include <clearcoat_normal_fragment_begin>\n\t#include <clearcoat_normal_fragment_maps>\n\t#include <emissivemap_fragment>\n\t#include <lights_physical_fragment>\n\t#include <lights_fragment_begin>\n\t#include <lights_fragment_maps>\n\t#include <lights_fragment_end>\n\t#include <aomap_fragment>\n\tvec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;\n\tvec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;\n\t#include <transmission_fragment>\n\tvec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n\t#ifdef USE_SHEEN\n \n\t\toutgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;\n \n \t#endif\n\t#ifdef USE_CLEARCOAT\n\t\tfloat dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );\n\t\tvec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );\n\t\toutgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;\n\t#endif\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n\t#include <dithering_fragment>\n}",
        meshtoon_vert: "#define TOON\nvarying vec3 vViewPosition;\n#include <common>\n#include <batching_pars_vertex>\n#include <uv_pars_vertex>\n#include <displacementmap_pars_vertex>\n#include <color_pars_vertex>\n#include <fog_pars_vertex>\n#include <normal_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <shadowmap_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\t#include <color_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphcolor_vertex>\n\t#include <batching_vertex>\n\t#include <beginnormal_vertex>\n\t#include <morphnormal_vertex>\n\t#include <skinbase_vertex>\n\t#include <skinnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <normal_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <displacementmap_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\tvViewPosition = - mvPosition.xyz;\n\t#include <worldpos_vertex>\n\t#include <shadowmap_vertex>\n\t#include <fog_vertex>\n}",
        meshtoon_frag: "#define TOON\nuniform vec3 diffuse;\nuniform vec3 emissive;\nuniform float opacity;\n#include <common>\n#include <dithering_pars_fragment>\n#include <color_pars_fragment>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <aomap_pars_fragment>\n#include <lightmap_pars_fragment>\n#include <emissivemap_pars_fragment>\n#include <gradientmap_pars_fragment>\n#include <fog_pars_fragment>\n#include <bsdfs>\n#include <lights_pars_begin>\n#include <normal_pars_fragment>\n#include <lights_toon_pars_fragment>\n#include <shadowmap_pars_fragment>\n#include <bumpmap_pars_fragment>\n#include <normalmap_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\tReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );\n\tvec3 totalEmissiveRadiance = emissive;\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <color_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\t#include <normal_fragment_begin>\n\t#include <normal_fragment_maps>\n\t#include <emissivemap_fragment>\n\t#include <lights_toon_fragment>\n\t#include <lights_fragment_begin>\n\t#include <lights_fragment_maps>\n\t#include <lights_fragment_end>\n\t#include <aomap_fragment>\n\tvec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n\t#include <dithering_fragment>\n}",
        points_vert: "uniform float size;\nuniform float scale;\n#include <common>\n#include <color_pars_vertex>\n#include <fog_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\n#ifdef USE_POINTS_UV\n\tvarying vec2 vUv;\n\tuniform mat3 uvTransform;\n#endif\nvoid main() {\n\t#ifdef USE_POINTS_UV\n\t\tvUv = ( uvTransform * vec3( uv, 1 ) ).xy;\n\t#endif\n\t#include <color_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphcolor_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <project_vertex>\n\tgl_PointSize = size;\n\t#ifdef USE_SIZEATTENUATION\n\t\tbool isPerspective = isPerspectiveMatrix( projectionMatrix );\n\t\tif ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );\n\t#endif\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\t#include <worldpos_vertex>\n\t#include <fog_vertex>\n}",
        points_frag: "uniform vec3 diffuse;\nuniform float opacity;\n#include <common>\n#include <color_pars_fragment>\n#include <map_particle_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <fog_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\tvec3 outgoingLight = vec3( 0.0 );\n\t#include <logdepthbuf_fragment>\n\t#include <map_particle_fragment>\n\t#include <color_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\toutgoingLight = diffuseColor.rgb;\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n}",
        shadow_vert: "#include <common>\n#include <batching_pars_vertex>\n#include <fog_pars_vertex>\n#include <morphtarget_pars_vertex>\n#include <skinning_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <shadowmap_pars_vertex>\nvoid main() {\n\t#include <batching_vertex>\n\t#include <beginnormal_vertex>\n\t#include <morphinstance_vertex>\n\t#include <morphnormal_vertex>\n\t#include <skinbase_vertex>\n\t#include <skinnormal_vertex>\n\t#include <defaultnormal_vertex>\n\t#include <begin_vertex>\n\t#include <morphtarget_vertex>\n\t#include <skinning_vertex>\n\t#include <project_vertex>\n\t#include <logdepthbuf_vertex>\n\t#include <worldpos_vertex>\n\t#include <shadowmap_vertex>\n\t#include <fog_vertex>\n}",
        shadow_frag: "uniform vec3 color;\nuniform float opacity;\n#include <common>\n#include <fog_pars_fragment>\n#include <bsdfs>\n#include <lights_pars_begin>\n#include <logdepthbuf_pars_fragment>\n#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>\nvoid main() {\n\t#include <logdepthbuf_fragment>\n\tgl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n\t#include <premultiplied_alpha_fragment>\n}",
        sprite_vert: "uniform float rotation;\nuniform vec2 center;\n#include <common>\n#include <uv_pars_vertex>\n#include <fog_pars_vertex>\n#include <logdepthbuf_pars_vertex>\n#include <clipping_planes_pars_vertex>\nvoid main() {\n\t#include <uv_vertex>\n\tvec4 mvPosition = modelViewMatrix[ 3 ];\n\tvec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );\n\t#ifndef USE_SIZEATTENUATION\n\t\tbool isPerspective = isPerspectiveMatrix( projectionMatrix );\n\t\tif ( isPerspective ) scale *= - mvPosition.z;\n\t#endif\n\tvec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;\n\tvec2 rotatedPosition;\n\trotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;\n\trotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;\n\tmvPosition.xy += rotatedPosition;\n\tgl_Position = projectionMatrix * mvPosition;\n\t#include <logdepthbuf_vertex>\n\t#include <clipping_planes_vertex>\n\t#include <fog_vertex>\n}",
        sprite_frag: "uniform vec3 diffuse;\nuniform float opacity;\n#include <common>\n#include <uv_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>\n#include <alphahash_pars_fragment>\n#include <fog_pars_fragment>\n#include <logdepthbuf_pars_fragment>\n#include <clipping_planes_pars_fragment>\nvoid main() {\n\tvec4 diffuseColor = vec4( diffuse, opacity );\n\t#include <clipping_planes_fragment>\n\tvec3 outgoingLight = vec3( 0.0 );\n\t#include <logdepthbuf_fragment>\n\t#include <map_fragment>\n\t#include <alphamap_fragment>\n\t#include <alphatest_fragment>\n\t#include <alphahash_fragment>\n\toutgoingLight = diffuseColor.rgb;\n\t#include <opaque_fragment>\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n\t#include <fog_fragment>\n}"
    },
    ga = {
        common: {
            diffuse: {
                value: new he(16777215)
            },
            opacity: {
                value: 1
            },
            map: {
                value: null
            },
            mapTransform: {
                value: new lt
            },
            alphaMap: {
                value: null
            },
            alphaMapTransform: {
                value: new lt
            },
            alphaTest: {
                value: 0
            }
        },
        specularmap: {
            specularMap: {
                value: null
            },
            specularMapTransform: {
                value: new lt
            }
        },
        envmap: {
            envMap: {
                value: null
            },
            envMapRotation: {
                value: new lt
            },
            flipEnvMap: {
                value: -1
            },
            reflectivity: {
                value: 1
            },
            ior: {
                value: 1.5
            },
            refractionRatio: {
                value: .98
            },
            dfgLUT: {
                value: null
            }
        },
        aomap: {
            aoMap: {
                value: null
            },
            aoMapIntensity: {
                value: 1
            },
            aoMapTransform: {
                value: new lt
            }
        },
        lightmap: {
            lightMap: {
                value: null
            },
            lightMapIntensity: {
                value: 1
            },
            lightMapTransform: {
                value: new lt
            }
        },
        bumpmap: {
            bumpMap: {
                value: null
            },
            bumpMapTransform: {
                value: new lt
            },
            bumpScale: {
                value: 1
            }
        },
        normalmap: {
            normalMap: {
                value: null
            },
            normalMapTransform: {
                value: new lt
            },
            normalScale: {
                value: new it(1, 1)
            }
        },
        displacementmap: {
            displacementMap: {
                value: null
            },
            displacementMapTransform: {
                value: new lt
            },
            displacementScale: {
                value: 1
            },
            displacementBias: {
                value: 0
            }
        },
        emissivemap: {
            emissiveMap: {
                value: null
            },
            emissiveMapTransform: {
                value: new lt
            }
        },
        metalnessmap: {
            metalnessMap: {
                value: null
            },
            metalnessMapTransform: {
                value: new lt
            }
        },
        roughnessmap: {
            roughnessMap: {
                value: null
            },
            roughnessMapTransform: {
                value: new lt
            }
        },
        gradientmap: {
            gradientMap: {
                value: null
            }
        },
        fog: {
            fogDensity: {
                value: 25e-5
            },
            fogNear: {
                value: 1
            },
            fogFar: {
                value: 2e3
            },
            fogColor: {
                value: new he(16777215)
            }
        },
        lights: {
            ambientLightColor: {
                value: []
            },
            lightProbe: {
                value: []
            },
            directionalLights: {
                value: [],
                properties: {
                    direction: {},
                    color: {}
                }
            },
            directionalLightShadows: {
                value: [],
                properties: {
                    shadowIntensity: 1,
                    shadowBias: {},
                    shadowNormalBias: {},
                    shadowRadius: {},
                    shadowMapSize: {}
                }
            },
            directionalShadowMatrix: {
                value: []
            },
            spotLights: {
                value: [],
                properties: {
                    color: {},
                    position: {},
                    direction: {},
                    distance: {},
                    coneCos: {},
                    penumbraCos: {},
                    decay: {}
                }
            },
            spotLightShadows: {
                value: [],
                properties: {
                    shadowIntensity: 1,
                    shadowBias: {},
                    shadowNormalBias: {},
                    shadowRadius: {},
                    shadowMapSize: {}
                }
            },
            spotLightMap: {
                value: []
            },
            spotLightMatrix: {
                value: []
            },
            pointLights: {
                value: [],
                properties: {
                    color: {},
                    position: {},
                    decay: {},
                    distance: {}
                }
            },
            pointLightShadows: {
                value: [],
                properties: {
                    shadowIntensity: 1,
                    shadowBias: {},
                    shadowNormalBias: {},
                    shadowRadius: {},
                    shadowMapSize: {},
                    shadowCameraNear: {},
                    shadowCameraFar: {}
                }
            },
            pointShadowMatrix: {
                value: []
            },
            hemisphereLights: {
                value: [],
                properties: {
                    direction: {},
                    skyColor: {},
                    groundColor: {}
                }
            },
            rectAreaLights: {
                value: [],
                properties: {
                    color: {},
                    position: {},
                    width: {},
                    height: {}
                }
            },
            ltc_1: {
                value: null
            },
            ltc_2: {
                value: null
            }
        },
        points: {
            diffuse: {
                value: new he(16777215)
            },
            opacity: {
                value: 1
            },
            size: {
                value: 1
            },
            scale: {
                value: 1
            },
            map: {
                value: null
            },
            alphaMap: {
                value: null
            },
            alphaMapTransform: {
                value: new lt
            },
            alphaTest: {
                value: 0
            },
            uvTransform: {
                value: new lt
            }
        },
        sprite: {
            diffuse: {
                value: new he(16777215)
            },
            opacity: {
                value: 1
            },
            center: {
                value: new it(.5, .5)
            },
            rotation: {
                value: 0
            },
            map: {
                value: null
            },
            mapTransform: {
                value: new lt
            },
            alphaMap: {
                value: null
            },
            alphaMapTransform: {
                value: new lt
            },
            alphaTest: {
                value: 0
            }
        }
    },
    _a = {
        basic: {
            uniforms: mi([ga.common, ga.specularmap, ga.envmap, ga.aomap, ga.lightmap, ga.fog]),
            vertexShader: fa.meshbasic_vert,
            fragmentShader: fa.meshbasic_frag
        },
        lambert: {
            uniforms: mi([ga.common, ga.specularmap, ga.envmap, ga.aomap, ga.lightmap, ga.emissivemap, ga.bumpmap, ga.normalmap, ga.displacementmap, ga.fog, ga.lights, {
                emissive: {
                    value: new he(0)
                },
                envMapIntensity: {
                    value: 1
                }
            }]),
            vertexShader: fa.meshlambert_vert,
            fragmentShader: fa.meshlambert_frag
        },
        phong: {
            uniforms: mi([ga.common, ga.specularmap, ga.envmap, ga.aomap, ga.lightmap, ga.emissivemap, ga.bumpmap, ga.normalmap, ga.displacementmap, ga.fog, ga.lights, {
                emissive: {
                    value: new he(0)
                },
                specular: {
                    value: new he(1118481)
                },
                shininess: {
                    value: 30
                },
                envMapIntensity: {
                    value: 1
                }
            }]),
            vertexShader: fa.meshphong_vert,
            fragmentShader: fa.meshphong_frag
        },
        standard: {
            uniforms: mi([ga.common, ga.envmap, ga.aomap, ga.lightmap, ga.emissivemap, ga.bumpmap, ga.normalmap, ga.displacementmap, ga.roughnessmap, ga.metalnessmap, ga.fog, ga.lights, {
                emissive: {
                    value: new he(0)
                },
                roughness: {
                    value: 1
                },
                metalness: {
                    value: 0
                },
                envMapIntensity: {
                    value: 1
                }
            }]),
            vertexShader: fa.meshphysical_vert,
            fragmentShader: fa.meshphysical_frag
        },
        toon: {
            uniforms: mi([ga.common, ga.aomap, ga.lightmap, ga.emissivemap, ga.bumpmap, ga.normalmap, ga.displacementmap, ga.gradientmap, ga.fog, ga.lights, {
                emissive: {
                    value: new he(0)
                }
            }]),
            vertexShader: fa.meshtoon_vert,
            fragmentShader: fa.meshtoon_frag
        },
        matcap: {
            uniforms: mi([ga.common, ga.bumpmap, ga.normalmap, ga.displacementmap, ga.fog, {
                matcap: {
                    value: null
                }
            }]),
            vertexShader: fa.meshmatcap_vert,
            fragmentShader: fa.meshmatcap_frag
        },
        points: {
            uniforms: mi([ga.points, ga.fog]),
            vertexShader: fa.points_vert,
            fragmentShader: fa.points_frag
        },
        dashed: {
            uniforms: mi([ga.common, ga.fog, {
                scale: {
                    value: 1
                },
                dashSize: {
                    value: 1
                },
                totalSize: {
                    value: 2
                }
            }]),
            vertexShader: fa.linedashed_vert,
            fragmentShader: fa.linedashed_frag
        },
        depth: {
            uniforms: mi([ga.common, ga.displacementmap]),
            vertexShader: fa.depth_vert,
            fragmentShader: fa.depth_frag
        },
        normal: {
            uniforms: mi([ga.common, ga.bumpmap, ga.normalmap, ga.displacementmap, {
                opacity: {
                    value: 1
                }
            }]),
            vertexShader: fa.meshnormal_vert,
            fragmentShader: fa.meshnormal_frag
        },
        sprite: {
            uniforms: mi([ga.sprite, ga.fog]),
            vertexShader: fa.sprite_vert,
            fragmentShader: fa.sprite_frag
        },
        background: {
            uniforms: {
                uvTransform: {
                    value: new lt
                },
                t2D: {
                    value: null
                },
                backgroundIntensity: {
                    value: 1
                }
            },
            vertexShader: fa.background_vert,
            fragmentShader: fa.background_frag
        },
        backgroundCube: {
            uniforms: {
                envMap: {
                    value: null
                },
                flipEnvMap: {
                    value: -1
                },
                backgroundBlurriness: {
                    value: 0
                },
                backgroundIntensity: {
                    value: 1
                },
                backgroundRotation: {
                    value: new lt
                }
            },
            vertexShader: fa.backgroundCube_vert,
            fragmentShader: fa.backgroundCube_frag
        },
        cube: {
            uniforms: {
                tCube: {
                    value: null
                },
                tFlip: {
                    value: -1
                },
                opacity: {
                    value: 1
                }
            },
            vertexShader: fa.cube_vert,
            fragmentShader: fa.cube_frag
        },
        equirect: {
            uniforms: {
                tEquirect: {
                    value: null
                }
            },
            vertexShader: fa.equirect_vert,
            fragmentShader: fa.equirect_frag
        },
        distance: {
            uniforms: mi([ga.common, ga.displacementmap, {
                referencePosition: {
                    value: new rt
                },
                nearDistance: {
                    value: 1
                },
                farDistance: {
                    value: 1e3
                }
            }]),
            vertexShader: fa.distance_vert,
            fragmentShader: fa.distance_frag
        },
        shadow: {
            uniforms: mi([ga.lights, ga.fog, {
                color: {
                    value: new he(0)
                },
                opacity: {
                    value: 1
                }
            }]),
            vertexShader: fa.shadow_vert,
            fragmentShader: fa.shadow_frag
        }
    };
_a.physical = {
    uniforms: mi([_a.standard.uniforms, {
        clearcoat: {
            value: 0
        },
        clearcoatMap: {
            value: null
        },
        clearcoatMapTransform: {
            value: new lt
        },
        clearcoatNormalMap: {
            value: null
        },
        clearcoatNormalMapTransform: {
            value: new lt
        },
        clearcoatNormalScale: {
            value: new it(1, 1)
        },
        clearcoatRoughness: {
            value: 0
        },
        clearcoatRoughnessMap: {
            value: null
        },
        clearcoatRoughnessMapTransform: {
            value: new lt
        },
        dispersion: {
            value: 0
        },
        iridescence: {
            value: 0
        },
        iridescenceMap: {
            value: null
        },
        iridescenceMapTransform: {
            value: new lt
        },
        iridescenceIOR: {
            value: 1.3
        },
        iridescenceThicknessMinimum: {
            value: 100
        },
        iridescenceThicknessMaximum: {
            value: 400
        },
        iridescenceThicknessMap: {
            value: null
        },
        iridescenceThicknessMapTransform: {
            value: new lt
        },
        sheen: {
            value: 0
        },
        sheenColor: {
            value: new he(0)
        },
        sheenColorMap: {
            value: null
        },
        sheenColorMapTransform: {
            value: new lt
        },
        sheenRoughness: {
            value: 1
        },
        sheenRoughnessMap: {
            value: null
        },
        sheenRoughnessMapTransform: {
            value: new lt
        },
        transmission: {
            value: 0
        },
        transmissionMap: {
            value: null
        },
        transmissionMapTransform: {
            value: new lt
        },
        transmissionSamplerSize: {
            value: new it
        },
        transmissionSamplerMap: {
            value: null
        },
        thickness: {
            value: 0
        },
        thicknessMap: {
            value: null
        },
        thicknessMapTransform: {
            value: new lt
        },
        attenuationDistance: {
            value: 0
        },
        attenuationColor: {
            value: new he(0)
        },
        specularColor: {
            value: new he(1, 1, 1)
        },
        specularColorMap: {
            value: null
        },
        specularColorMapTransform: {
            value: new lt
        },
        specularIntensity: {
            value: 1
        },
        specularIntensityMap: {
            value: null
        },
        specularIntensityMapTransform: {
            value: new lt
        },
        anisotropyVector: {
            value: new it
        },
        anisotropyMap: {
            value: null
        },
        anisotropyMapTransform: {
            value: new lt
        }
    }]),
    vertexShader: fa.meshphysical_vert,
    fragmentShader: fa.meshphysical_frag
};
var va = {
        r: 0,
        b: 0,
        g: 0
    },
    xa = new zt,
    Ma = new Ct;

function ba(t, e, n, i, a, r) {
    const s = new he(0);
    let o, l, c = !0 === a ? 0 : 1,
        h = null,
        u = 0,
        d = null;

    function p(t) {
        let n = !0 === t.isScene ? t.background : null;
        if (n && n.isTexture) {
            const i = t.backgroundBlurriness > 0;
            n = e.get(n, i)
        }
        return n
    }

    function m(e, i) {
        e.getRGB(va, fi(t)), n.buffers.color.setClear(va.r, va.g, va.b, i, r)
    }
    return {
        getClearColor: function() {
            return s
        },
        setClearColor: function(t, e = 1) {
            s.set(t), c = e, m(s, c)
        },
        getClearAlpha: function() {
            return c
        },
        setClearAlpha: function(t) {
            c = t, m(s, c)
        },
        render: function(e) {
            let i = !1;
            const a = p(e);
            null === a ? m(s, c) : a && a.isColor && (m(a, 1), i = !0);
            const o = t.xr.getEnvironmentBlendMode();
            "additive" === o ? n.buffers.color.setClear(0, 0, 0, 1, r) : "alpha-blend" === o && n.buffers.color.setClear(0, 0, 0, 0, r), (t.autoClear || i) && (n.buffers.depth.setTest(!0), n.buffers.depth.setMask(!0), n.buffers.color.setMask(!0), t.clear(t.autoClearColor, t.autoClearDepth, t.autoClearStencil))
        },
        addToRenderList: function(e, n) {
            const a = p(n);
            a && (a.isCubeTexture || 306 === a.mapping) ? (void 0 === l && (l = new Zn(new ui(1, 1, 1), new _i({
                name: "BackgroundCubeMaterial",
                uniforms: pi(_a.backgroundCube.uniforms),
                vertexShader: _a.backgroundCube.vertexShader,
                fragmentShader: _a.backgroundCube.fragmentShader,
                side: 1,
                depthTest: !1,
                depthWrite: !1,
                fog: !1,
                allowOverride: !1
            })), l.geometry.deleteAttribute("normal"), l.geometry.deleteAttribute("uv"), l.onBeforeRender = function(t, e, n) {
                this.matrixWorld.copyPosition(n.matrixWorld)
            }, Object.defineProperty(l.material, "envMap", {
                get: function() {
                    return this.uniforms.envMap.value
                }
            }), i.update(l)), xa.copy(n.backgroundRotation), xa.x *= -1, xa.y *= -1, xa.z *= -1, a.isCubeTexture && !1 === a.isRenderTargetTexture && (xa.y *= -1, xa.z *= -1), l.material.uniforms.envMap.value = a, l.material.uniforms.flipEnvMap.value = a.isCubeTexture && !1 === a.isRenderTargetTexture ? -1 : 1, l.material.uniforms.backgroundBlurriness.value = n.backgroundBlurriness, l.material.uniforms.backgroundIntensity.value = n.backgroundIntensity, l.material.uniforms.backgroundRotation.value.setFromMatrix4(Ma.makeRotationFromEuler(xa)), l.material.toneMapped = mt.getTransfer(a.colorSpace) !== I, h === a && u === a.version && d === t.toneMapping || (l.material.needsUpdate = !0, h = a, u = a.version, d = t.toneMapping), l.layers.enableAll(), e.unshift(l, l.geometry, l.material, 0, 0, null)) : a && a.isTexture && (void 0 === o && (o = new Zn(new di(2, 2), new _i({
                name: "BackgroundMaterial",
                uniforms: pi(_a.background.uniforms),
                vertexShader: _a.background.vertexShader,
                fragmentShader: _a.background.fragmentShader,
                side: 0,
                depthTest: !1,
                depthWrite: !1,
                fog: !1,
                allowOverride: !1
            })), o.geometry.deleteAttribute("normal"), Object.defineProperty(o.material, "map", {
                get: function() {
                    return this.uniforms.t2D.value
                }
            }), i.update(o)), o.material.uniforms.t2D.value = a, o.material.uniforms.backgroundIntensity.value = n.backgroundIntensity, o.material.toneMapped = mt.getTransfer(a.colorSpace) !== I, !0 === a.matrixAutoUpdate && a.updateMatrix(), o.material.uniforms.uvTransform.value.copy(a.matrix), h === a && u === a.version && d === t.toneMapping || (o.material.needsUpdate = !0, h = a, u = a.version, d = t.toneMapping), o.layers.enableAll(), e.unshift(o, o.geometry, o.material, 0, 0, null))
        },
        dispose: function() {
            void 0 !== l && (l.geometry.dispose(), l.material.dispose(), l = void 0), void 0 !== o && (o.geometry.dispose(), o.material.dispose(), o = void 0)
        }
    }
}

function ya(t, e) {
    const n = t.getParameter(t.MAX_VERTEX_ATTRIBS),
        i = {},
        a = c(null);
    let r = a,
        s = !1;

    function o(e) {
        return t.bindVertexArray(e)
    }

    function l(e) {
        return t.deleteVertexArray(e)
    }

    function c(t) {
        const e = [],
            i = [],
            a = [];
        for (let r = 0; r < n; r++) e[r] = 0, i[r] = 0, a[r] = 0;
        return {
            geometry: null,
            program: null,
            wireframe: !1,
            newAttributes: e,
            enabledAttributes: i,
            attributeDivisors: a,
            object: t,
            attributes: {},
            index: null
        }
    }

    function h() {
        const t = r.newAttributes;
        for (let e = 0, n = t.length; e < n; e++) t[e] = 0
    }

    function u(t) {
        d(t, 0)
    }

    function d(e, n) {
        const i = r.newAttributes,
            a = r.enabledAttributes,
            s = r.attributeDivisors;
        i[e] = 1, 0 === a[e] && (t.enableVertexAttribArray(e), a[e] = 1), s[e] !== n && (t.vertexAttribDivisor(e, n), s[e] = n)
    }

    function p() {
        const e = r.newAttributes,
            n = r.enabledAttributes;
        for (let i = 0, a = n.length; i < a; i++) n[i] !== e[i] && (t.disableVertexAttribArray(i), n[i] = 0)
    }

    function m(e, n, i, a, r, s, o) {
        !0 === o ? t.vertexAttribIPointer(e, n, i, r, s) : t.vertexAttribPointer(e, n, i, a, r, s)
    }

    function f() {
        g(), s = !0, r !== a && (r = a, o(r.object))
    }

    function g() {
        a.geometry = null, a.program = null, a.wireframe = !1
    }
    return {
        setup: function(n, a, l, f, g) {
            let _ = !1;
            const v = function(e, n, a, r) {
                const s = !0 === r.wireframe;
                let o = i[n.id];
                void 0 === o && (o = {}, i[n.id] = o);
                const l = !0 === e.isInstancedMesh ? e.id : 0;
                let h = o[l];
                void 0 === h && (h = {}, o[l] = h);
                let u = h[a.id];
                void 0 === u && (u = {}, h[a.id] = u);
                let d = u[s];
                void 0 === d && (d = c(t.createVertexArray()), u[s] = d);
                return d
            }(n, f, l, a);
            r !== v && (r = v, o(r.object)), _ = function(t, e, n, i) {
                const a = r.attributes,
                    s = e.attributes;
                let o = 0;
                const l = n.getAttributes();
                for (const r in l)
                    if (l[r].location >= 0) {
                        const e = a[r];
                        let n = s[r];
                        if (void 0 === n && ("instanceMatrix" === r && t.instanceMatrix && (n = t.instanceMatrix), "instanceColor" === r && t.instanceColor && (n = t.instanceColor)), void 0 === e) return !0;
                        if (e.attribute !== n) return !0;
                        if (n && e.data !== n.data) return !0;
                        o++
                    } return r.attributesNum !== o || r.index !== i
            }(n, f, l, g), _ && function(t, e, n, i) {
                const a = {},
                    s = e.attributes;
                let o = 0;
                const l = n.getAttributes();
                for (const r in l)
                    if (l[r].location >= 0) {
                        let e = s[r];
                        void 0 === e && ("instanceMatrix" === r && t.instanceMatrix && (e = t.instanceMatrix), "instanceColor" === r && t.instanceColor && (e = t.instanceColor));
                        const n = {};
                        n.attribute = e, e && e.data && (n.data = e.data), a[r] = n, o++
                    } r.attributes = a, r.attributesNum = o, r.index = i
            }(n, f, l, g), null !== g && e.update(g, t.ELEMENT_ARRAY_BUFFER), (_ || s) && (s = !1, function(n, i, a, r) {
                h();
                const s = r.attributes,
                    o = a.getAttributes(),
                    l = i.defaultAttributeValues;
                for (const c in o) {
                    const i = o[c];
                    if (i.location >= 0) {
                        let a = s[c];
                        if (void 0 === a && ("instanceMatrix" === c && n.instanceMatrix && (a = n.instanceMatrix), "instanceColor" === c && n.instanceColor && (a = n.instanceColor)), void 0 !== a) {
                            const s = a.normalized,
                                o = a.itemSize,
                                l = e.get(a);
                            if (void 0 === l) continue;
                            const c = l.buffer,
                                h = l.type,
                                p = l.bytesPerElement,
                                f = h === t.INT || h === t.UNSIGNED_INT || 1013 === a.gpuType;
                            if (a.isInterleavedBufferAttribute) {
                                const e = a.data,
                                    l = e.stride,
                                    g = a.offset;
                                if (e.isInstancedInterleavedBuffer) {
                                    for (let t = 0; t < i.locationSize; t++) d(i.location + t, e.meshPerAttribute);
                                    !0 !== n.isInstancedMesh && void 0 === r._maxInstanceCount && (r._maxInstanceCount = e.meshPerAttribute * e.count)
                                } else
                                    for (let t = 0; t < i.locationSize; t++) u(i.location + t);
                                t.bindBuffer(t.ARRAY_BUFFER, c);
                                for (let t = 0; t < i.locationSize; t++) m(i.location + t, o / i.locationSize, h, s, l * p, (g + o / i.locationSize * t) * p, f)
                            } else {
                                if (a.isInstancedBufferAttribute) {
                                    for (let t = 0; t < i.locationSize; t++) d(i.location + t, a.meshPerAttribute);
                                    !0 !== n.isInstancedMesh && void 0 === r._maxInstanceCount && (r._maxInstanceCount = a.meshPerAttribute * a.count)
                                } else
                                    for (let t = 0; t < i.locationSize; t++) u(i.location + t);
                                t.bindBuffer(t.ARRAY_BUFFER, c);
                                for (let t = 0; t < i.locationSize; t++) m(i.location + t, o / i.locationSize, h, s, o * p, o / i.locationSize * t * p, f)
                            }
                        } else if (void 0 !== l) {
                            const e = l[c];
                            if (void 0 !== e) switch (e.length) {
                                case 2:
                                    t.vertexAttrib2fv(i.location, e);
                                    break;
                                case 3:
                                    t.vertexAttrib3fv(i.location, e);
                                    break;
                                case 4:
                                    t.vertexAttrib4fv(i.location, e);
                                    break;
                                default:
                                    t.vertexAttrib1fv(i.location, e)
                            }
                        }
                    }
                }
                p()
            }(n, a, l, f), null !== g && t.bindBuffer(t.ELEMENT_ARRAY_BUFFER, e.get(g).buffer))
        },
        reset: f,
        resetDefaultState: g,
        dispose: function() {
            f();
            for (const t in i) {
                const e = i[t];
                for (const t in e) {
                    const n = e[t];
                    for (const t in n) {
                        const e = n[t];
                        for (const t in e) l(e[t].object), delete e[t];
                        delete n[t]
                    }
                }
                delete i[t]
            }
        },
        releaseStatesOfGeometry: function(t) {
            if (void 0 === i[t.id]) return;
            const e = i[t.id];
            for (const n in e) {
                const t = e[n];
                for (const e in t) {
                    const n = t[e];
                    for (const t in n) l(n[t].object), delete n[t];
                    delete t[e]
                }
            }
            delete i[t.id]
        },
        releaseStatesOfObject: function(t) {
            for (const e in i) {
                const n = i[e],
                    a = !0 === t.isInstancedMesh ? t.id : 0,
                    r = n[a];
                if (void 0 !== r) {
                    for (const t in r) {
                        const e = r[t];
                        for (const t in e) l(e[t].object), delete e[t];
                        delete r[t]
                    }
                    delete n[a], 0 === Object.keys(n).length && delete i[e]
                }
            }
        },
        releaseStatesOfProgram: function(t) {
            for (const e in i) {
                const n = i[e];
                for (const e in n) {
                    const i = n[e];
                    if (void 0 === i[t.id]) continue;
                    const a = i[t.id];
                    for (const t in a) l(a[t].object), delete a[t];
                    delete i[t.id]
                }
            }
        },
        initAttributes: h,
        enableAttribute: u,
        disableUnusedAttributes: p
    }
}

function Sa(t, e, n) {
    let i;

    function a(e, a, r) {
        0 !== r && (t.drawArraysInstanced(i, e, a, r), n.update(a, i, r))
    }
    this.setMode = function(t) {
        i = t
    }, this.render = function(e, a) {
        t.drawArrays(i, e, a), n.update(a, i, 1)
    }, this.renderInstances = a, this.renderMultiDraw = function(t, a, r) {
        if (0 === r) return;
        e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(i, t, 0, a, 0, r);
        let s = 0;
        for (let e = 0; e < r; e++) s += a[e];
        n.update(s, i, 1)
    }, this.renderMultiDrawInstances = function(t, r, s, o) {
        if (0 === s) return;
        const l = e.get("WEBGL_multi_draw");
        if (null === l)
            for (let e = 0; e < t.length; e++) a(t[e], r[e], o[e]);
        else {
            l.multiDrawArraysInstancedWEBGL(i, t, 0, r, 0, o, 0, s);
            let e = 0;
            for (let t = 0; t < s; t++) e += r[t] * o[t];
            n.update(e, i, 1)
        }
    }
}

function Ea(t, e, n, i) {
    let a;

    function r(e) {
        if ("highp" === e) {
            if (t.getShaderPrecisionFormat(t.VERTEX_SHADER, t.HIGH_FLOAT).precision > 0 && t.getShaderPrecisionFormat(t.FRAGMENT_SHADER, t.HIGH_FLOAT).precision > 0) return "highp";
            e = "mediump"
        }
        return "mediump" === e && t.getShaderPrecisionFormat(t.VERTEX_SHADER, t.MEDIUM_FLOAT).precision > 0 && t.getShaderPrecisionFormat(t.FRAGMENT_SHADER, t.MEDIUM_FLOAT).precision > 0 ? "mediump" : "lowp"
    }
    let s = void 0 !== n.precision ? n.precision : "highp";
    const o = r(s);
    o !== s && (k("WebGLRenderer:", s, "not supported, using", o, "instead."), s = o);
    return {
        isWebGL2: !0,
        getMaxAnisotropy: function() {
            if (void 0 !== a) return a;
            if (!0 === e.has("EXT_texture_filter_anisotropic")) {
                const n = e.get("EXT_texture_filter_anisotropic");
                a = t.getParameter(n.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
            } else a = 0;
            return a
        },
        getMaxPrecision: r,
        textureFormatReadable: function(e) {
            return 1023 === e || i.convert(e) === t.getParameter(t.IMPLEMENTATION_COLOR_READ_FORMAT)
        },
        textureTypeReadable: function(n) {
            const a = 1016 === n && (e.has("EXT_color_buffer_half_float") || e.has("EXT_color_buffer_float"));
            return !(1009 !== n && i.convert(n) !== t.getParameter(t.IMPLEMENTATION_COLOR_READ_TYPE) && 1015 !== n && !a)
        },
        precision: s,
        logarithmicDepthBuffer: !0 === n.logarithmicDepthBuffer,
        reversedDepthBuffer: !0 === n.reversedDepthBuffer && e.has("EXT_clip_control"),
        maxTextures: t.getParameter(t.MAX_TEXTURE_IMAGE_UNITS),
        maxVertexTextures: t.getParameter(t.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
        maxTextureSize: t.getParameter(t.MAX_TEXTURE_SIZE),
        maxCubemapSize: t.getParameter(t.MAX_CUBE_MAP_TEXTURE_SIZE),
        maxAttributes: t.getParameter(t.MAX_VERTEX_ATTRIBS),
        maxVertexUniforms: t.getParameter(t.MAX_VERTEX_UNIFORM_VECTORS),
        maxVaryings: t.getParameter(t.MAX_VARYING_VECTORS),
        maxFragmentUniforms: t.getParameter(t.MAX_FRAGMENT_UNIFORM_VECTORS),
        maxSamples: t.getParameter(t.MAX_SAMPLES),
        samples: t.getParameter(t.SAMPLES)
    }
}

function Ta(t) {
    const e = this;
    let n = null,
        i = 0,
        a = !1,
        r = !1;
    const s = new ei,
        o = new lt,
        l = {
            value: null,
            needsUpdate: !1
        };

    function c(t, n, i, a) {
        const r = null !== t ? t.length : 0;
        let c = null;
        if (0 !== r) {
            if (c = l.value, !0 !== a || null === c) {
                const e = i + 4 * r,
                    a = n.matrixWorldInverse;
                o.getNormalMatrix(a), (null === c || c.length < e) && (c = new Float32Array(e));
                for (let n = 0, l = i; n !== r; ++n, l += 4) s.copy(t[n]).applyMatrix4(a, o), s.normal.toArray(c, l), c[l + 3] = s.constant
            }
            l.value = c, l.needsUpdate = !0
        }
        return e.numPlanes = r, e.numIntersection = 0, c
    }
    this.uniform = l, this.numPlanes = 0, this.numIntersection = 0, this.init = function(t, e) {
        const n = 0 !== t.length || e || 0 !== i || a;
        return a = e, i = t.length, n
    }, this.beginShadows = function() {
        r = !0, c(null)
    }, this.endShadows = function() {
        r = !1
    }, this.setGlobalState = function(t, e) {
        n = c(t, e, 0)
    }, this.setState = function(s, o, h) {
        const u = s.clippingPlanes,
            d = s.clipIntersection,
            p = s.clipShadows,
            m = t.get(s);
        if (!a || null === u || 0 === u.length || r && !p) r ? c(null) : function() {
            l.value !== n && (l.value = n, l.needsUpdate = i > 0);
            e.numPlanes = i, e.numIntersection = 0
        }();
        else {
            const t = r ? 0 : i,
                e = 4 * t;
            let a = m.clippingState || null;
            l.value = a, a = c(u, o, e, h);
            for (let i = 0; i !== e; ++i) a[i] = n[i];
            m.clippingState = a, this.numIntersection = d ? this.numPlanes : 0, this.numPlanes += t
        }
    }
}
var wa = [.125, .215, .35, .446, .526, .582],
    Aa = 20,
    Ra = new Yi,
    Ca = new he,
    Pa = null,
    Da = 0,
    La = 0,
    Ia = !1,
    Ua = new rt,
    Na = class {
        constructor(t) {
            this._renderer = t, this._pingPongRenderTarget = null, this._lodMax = 0, this._cubeSize = 0, this._sizeLods = [], this._sigmas = [], this._lodMeshes = [], this._backgroundBox = null, this._cubemapMaterial = null, this._equirectMaterial = null, this._blurMaterial = null, this._ggxMaterial = null
        }
        fromScene(t, e = 0, n = .1, i = 100, a = {}) {
            const {
                size: r = 256,
                position: s = Ua
            } = a;
            Pa = this._renderer.getRenderTarget(), Da = this._renderer.getActiveCubeFace(), La = this._renderer.getActiveMipmapLevel(), Ia = this._renderer.xr.enabled, this._renderer.xr.enabled = !1, this._setSize(r);
            const o = this._allocateTargets();
            return o.depthBuffer = !0, this._sceneToCubeUV(t, n, i, o, s), e > 0 && this._blur(o, 0, 0, e), this._applyPMREM(o), this._cleanup(o), o
        }
        fromEquirectangular(t, e = null) {
            return this._fromTexture(t, e)
        }
        fromCubemap(t, e = null) {
            return this._fromTexture(t, e)
        }
        compileCubemapShader() {
            null === this._cubemapMaterial && (this._cubemapMaterial = za(), this._compileMaterial(this._cubemapMaterial))
        }
        compileEquirectangularShader() {
            null === this._equirectMaterial && (this._equirectMaterial = Ba(), this._compileMaterial(this._equirectMaterial))
        }
        dispose() {
            this._dispose(), null !== this._cubemapMaterial && this._cubemapMaterial.dispose(), null !== this._equirectMaterial && this._equirectMaterial.dispose(), null !== this._backgroundBox && (this._backgroundBox.geometry.dispose(), this._backgroundBox.material.dispose())
        }
        _setSize(t) {
            this._lodMax = Math.floor(Math.log2(t)), this._cubeSize = Math.pow(2, this._lodMax)
        }
        _dispose() {
            null !== this._blurMaterial && this._blurMaterial.dispose(), null !== this._ggxMaterial && this._ggxMaterial.dispose(), null !== this._pingPongRenderTarget && this._pingPongRenderTarget.dispose();
            for (let t = 0; t < this._lodMeshes.length; t++) this._lodMeshes[t].geometry.dispose()
        }
        _cleanup(t) {
            this._renderer.setRenderTarget(Pa, Da, La), this._renderer.xr.enabled = Ia, t.scissorTest = !1, Fa(t, 0, 0, t.width, t.height)
        }
        _fromTexture(t, e) {
            301 === t.mapping || 302 === t.mapping ? this._setSize(0 === t.image.length ? 16 : t.image[0].width || t.image[0].image.width) : this._setSize(t.image.width / 4), Pa = this._renderer.getRenderTarget(), Da = this._renderer.getActiveCubeFace(), La = this._renderer.getActiveMipmapLevel(), Ia = this._renderer.xr.enabled, this._renderer.xr.enabled = !1;
            const n = e || this._allocateTargets();
            return this._textureToCubeUV(t, n), this._applyPMREM(n), this._cleanup(n), n
        }
        _allocateTargets() {
            const t = 3 * Math.max(this._cubeSize, 112),
                e = 4 * this._cubeSize,
                n = {
                    magFilter: m,
                    minFilter: m,
                    generateMipmaps: !1,
                    type: b,
                    format: E,
                    colorSpace: D,
                    depthBuffer: !1
                },
                i = Oa(t, e, n);
            if (null === this._pingPongRenderTarget || this._pingPongRenderTarget.width !== t || this._pingPongRenderTarget.height !== e) {
                null !== this._pingPongRenderTarget && this._dispose(), this._pingPongRenderTarget = Oa(t, e, n);
                const {
                    _lodMax: i
                } = this;
                ({
                    lodMeshes: this._lodMeshes,
                    sizeLods: this._sizeLods,
                    sigmas: this._sigmas
                } = function(t) {
                    const e = [],
                        n = [],
                        i = [];
                    let a = t;
                    const r = t - 4 + 1 + wa.length;
                    for (let s = 0; s < r; s++) {
                        const r = Math.pow(2, a);
                        e.push(r);
                        let o = 1 / r;
                        s > t - 4 ? o = wa[s - t + 4 - 1] : 0 === s && (o = 0), n.push(o);
                        const l = 1 / (r - 2),
                            c = -l,
                            h = 1 + l,
                            u = [c, c, h, c, h, h, c, c, h, h, c, h],
                            d = 6,
                            p = 6,
                            m = 3,
                            f = 2,
                            g = 1,
                            _ = new Float32Array(m * p * d),
                            v = new Float32Array(f * p * d),
                            x = new Float32Array(g * p * d);
                        for (let t = 0; t < d; t++) {
                            const e = t % 3 * 2 / 3 - 1,
                                n = t > 2 ? 0 : -1,
                                i = [e, n, 0, e + 2 / 3, n, 0, e + 2 / 3, n + 1, 0, e, n, 0, e + 2 / 3, n + 1, 0, e, n + 1, 0];
                            _.set(i, m * p * t), v.set(u, f * p * t);
                            const a = [t, t, t, t, t, t];
                            x.set(a, g * p * t)
                        }
                        const M = new ln;
                        M.setAttribute("position", new Ye(_, m)), M.setAttribute("uv", new Ye(v, f)), M.setAttribute("faceIndex", new Ye(x, g)), i.push(new Zn(M, null)), a > 4 && a--
                    }
                    return {
                        lodMeshes: i,
                        sizeLods: e,
                        sigmas: n
                    }
                }(i)), this._blurMaterial = function(t, e, n) {
                    const i = new Float32Array(Aa),
                        a = new rt(0, 1, 0);
                    return new _i({
                        name: "SphericalGaussianBlur",
                        defines: {
                            n: Aa,
                            CUBEUV_TEXEL_WIDTH: 1 / e,
                            CUBEUV_TEXEL_HEIGHT: 1 / n,
                            CUBEUV_MAX_MIP: `${t}.0`
                        },
                        uniforms: {
                            envMap: {
                                value: null
                            },
                            samples: {
                                value: 1
                            },
                            weights: {
                                value: i
                            },
                            latitudinal: {
                                value: !1
                            },
                            dTheta: {
                                value: 0
                            },
                            mipInt: {
                                value: 0
                            },
                            poleAxis: {
                                value: a
                            }
                        },
                        vertexShader: Va(),
                        fragmentShader: "\n\n\t\t\tprecision mediump float;\n\t\t\tprecision mediump int;\n\n\t\t\tvarying vec3 vOutputDirection;\n\n\t\t\tuniform sampler2D envMap;\n\t\t\tuniform int samples;\n\t\t\tuniform float weights[ n ];\n\t\t\tuniform bool latitudinal;\n\t\t\tuniform float dTheta;\n\t\t\tuniform float mipInt;\n\t\t\tuniform vec3 poleAxis;\n\n\t\t\t#define ENVMAP_TYPE_CUBE_UV\n\t\t\t#include <cube_uv_reflection_fragment>\n\n\t\t\tvec3 getSample( float theta, vec3 axis ) {\n\n\t\t\t\tfloat cosTheta = cos( theta );\n\t\t\t\t// Rodrigues' axis-angle rotation\n\t\t\t\tvec3 sampleDirection = vOutputDirection * cosTheta\n\t\t\t\t\t+ cross( axis, vOutputDirection ) * sin( theta )\n\t\t\t\t\t+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );\n\n\t\t\t\treturn bilinearCubeUV( envMap, sampleDirection, mipInt );\n\n\t\t\t}\n\n\t\t\tvoid main() {\n\n\t\t\t\tvec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );\n\n\t\t\t\tif ( all( equal( axis, vec3( 0.0 ) ) ) ) {\n\n\t\t\t\t\taxis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );\n\n\t\t\t\t}\n\n\t\t\t\taxis = normalize( axis );\n\n\t\t\t\tgl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );\n\t\t\t\tgl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );\n\n\t\t\t\tfor ( int i = 1; i < n; i++ ) {\n\n\t\t\t\t\tif ( i >= samples ) {\n\n\t\t\t\t\t\tbreak;\n\n\t\t\t\t\t}\n\n\t\t\t\t\tfloat theta = dTheta * float( i );\n\t\t\t\t\tgl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );\n\t\t\t\t\tgl_FragColor.rgb += weights[ i ] * getSample( theta, axis );\n\n\t\t\t\t}\n\n\t\t\t}\n\t\t",
                        blending: 0,
                        depthTest: !1,
                        depthWrite: !1
                    })
                }(i, t, e), this._ggxMaterial = function(t, e, n) {
                    return new _i({
                        name: "PMREMGGXConvolution",
                        defines: {
                            GGX_SAMPLES: 256,
                            CUBEUV_TEXEL_WIDTH: 1 / e,
                            CUBEUV_TEXEL_HEIGHT: 1 / n,
                            CUBEUV_MAX_MIP: `${t}.0`
                        },
                        uniforms: {
                            envMap: {
                                value: null
                            },
                            roughness: {
                                value: 0
                            },
                            mipInt: {
                                value: 0
                            }
                        },
                        vertexShader: Va(),
                        fragmentShader: '\n\n\t\t\tprecision highp float;\n\t\t\tprecision highp int;\n\n\t\t\tvarying vec3 vOutputDirection;\n\n\t\t\tuniform sampler2D envMap;\n\t\t\tuniform float roughness;\n\t\t\tuniform float mipInt;\n\n\t\t\t#define ENVMAP_TYPE_CUBE_UV\n\t\t\t#include <cube_uv_reflection_fragment>\n\n\t\t\t#define PI 3.14159265359\n\n\t\t\t// Van der Corput radical inverse\n\t\t\tfloat radicalInverse_VdC(uint bits) {\n\t\t\t\tbits = (bits << 16u) | (bits >> 16u);\n\t\t\t\tbits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);\n\t\t\t\tbits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);\n\t\t\t\tbits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);\n\t\t\t\tbits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);\n\t\t\t\treturn float(bits) * 2.3283064365386963e-10; // / 0x100000000\n\t\t\t}\n\n\t\t\t// Hammersley sequence\n\t\t\tvec2 hammersley(uint i, uint N) {\n\t\t\t\treturn vec2(float(i) / float(N), radicalInverse_VdC(i));\n\t\t\t}\n\n\t\t\t// GGX VNDF importance sampling (Eric Heitz 2018)\n\t\t\t// "Sampling the GGX Distribution of Visible Normals"\n\t\t\t// https://jcgt.org/published/0007/04/01/\n\t\t\tvec3 importanceSampleGGX_VNDF(vec2 Xi, vec3 V, float roughness) {\n\t\t\t\tfloat alpha = roughness * roughness;\n\n\t\t\t\t// Section 4.1: Orthonormal basis\n\t\t\t\tvec3 T1 = vec3(1.0, 0.0, 0.0);\n\t\t\t\tvec3 T2 = cross(V, T1);\n\n\t\t\t\t// Section 4.2: Parameterization of projected area\n\t\t\t\tfloat r = sqrt(Xi.x);\n\t\t\t\tfloat phi = 2.0 * PI * Xi.y;\n\t\t\t\tfloat t1 = r * cos(phi);\n\t\t\t\tfloat t2 = r * sin(phi);\n\t\t\t\tfloat s = 0.5 * (1.0 + V.z);\n\t\t\t\tt2 = (1.0 - s) * sqrt(1.0 - t1 * t1) + s * t2;\n\n\t\t\t\t// Section 4.3: Reprojection onto hemisphere\n\t\t\t\tvec3 Nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * V;\n\n\t\t\t\t// Section 3.4: Transform back to ellipsoid configuration\n\t\t\t\treturn normalize(vec3(alpha * Nh.x, alpha * Nh.y, max(0.0, Nh.z)));\n\t\t\t}\n\n\t\t\tvoid main() {\n\t\t\t\tvec3 N = normalize(vOutputDirection);\n\t\t\t\tvec3 V = N; // Assume view direction equals normal for pre-filtering\n\n\t\t\t\tvec3 prefilteredColor = vec3(0.0);\n\t\t\t\tfloat totalWeight = 0.0;\n\n\t\t\t\t// For very low roughness, just sample the environment directly\n\t\t\t\tif (roughness < 0.001) {\n\t\t\t\t\tgl_FragColor = vec4(bilinearCubeUV(envMap, N, mipInt), 1.0);\n\t\t\t\t\treturn;\n\t\t\t\t}\n\n\t\t\t\t// Tangent space basis for VNDF sampling\n\t\t\t\tvec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);\n\t\t\t\tvec3 tangent = normalize(cross(up, N));\n\t\t\t\tvec3 bitangent = cross(N, tangent);\n\n\t\t\t\tfor(uint i = 0u; i < uint(GGX_SAMPLES); i++) {\n\t\t\t\t\tvec2 Xi = hammersley(i, uint(GGX_SAMPLES));\n\n\t\t\t\t\t// For PMREM, V = N, so in tangent space V is always (0, 0, 1)\n\t\t\t\t\tvec3 H_tangent = importanceSampleGGX_VNDF(Xi, vec3(0.0, 0.0, 1.0), roughness);\n\n\t\t\t\t\t// Transform H back to world space\n\t\t\t\t\tvec3 H = normalize(tangent * H_tangent.x + bitangent * H_tangent.y + N * H_tangent.z);\n\t\t\t\t\tvec3 L = normalize(2.0 * dot(V, H) * H - V);\n\n\t\t\t\t\tfloat NdotL = max(dot(N, L), 0.0);\n\n\t\t\t\t\tif(NdotL > 0.0) {\n\t\t\t\t\t\t// Sample environment at fixed mip level\n\t\t\t\t\t\t// VNDF importance sampling handles the distribution filtering\n\t\t\t\t\t\tvec3 sampleColor = bilinearCubeUV(envMap, L, mipInt);\n\n\t\t\t\t\t\t// Weight by NdotL for the split-sum approximation\n\t\t\t\t\t\t// VNDF PDF naturally accounts for the visible microfacet distribution\n\t\t\t\t\t\tprefilteredColor += sampleColor * NdotL;\n\t\t\t\t\t\ttotalWeight += NdotL;\n\t\t\t\t\t}\n\t\t\t\t}\n\n\t\t\t\tif (totalWeight > 0.0) {\n\t\t\t\t\tprefilteredColor = prefilteredColor / totalWeight;\n\t\t\t\t}\n\n\t\t\t\tgl_FragColor = vec4(prefilteredColor, 1.0);\n\t\t\t}\n\t\t',
                        blending: 0,
                        depthTest: !1,
                        depthWrite: !1
                    })
                }(i, t, e)
            }
            return i
        }
        _compileMaterial(t) {
            const e = new Zn(new ln, t);
            this._renderer.compile(e, Ra)
        }
        _sceneToCubeUV(t, e, n, i, a) {
            const r = new Xi(90, 1, e, n),
                s = [1, -1, 1, 1, 1, 1],
                o = [1, 1, 1, -1, -1, -1],
                l = this._renderer,
                c = l.autoClear,
                h = l.toneMapping;
            l.getClearColor(Ca), l.toneMapping = 0, l.autoClear = !1, l.state.buffers.depth.getReversed() && (l.setRenderTarget(i), l.clearDepth(), l.setRenderTarget(null)), null === this._backgroundBox && (this._backgroundBox = new Zn(new ui, new Fn({
                name: "PMREM.Background",
                side: 1,
                depthWrite: !1,
                depthTest: !1
            })));
            const u = this._backgroundBox,
                d = u.material;
            let p = !1;
            const m = t.background;
            m ? m.isColor && (d.color.copy(m), t.background = null, p = !0) : (d.color.copy(Ca), p = !0);
            for (let f = 0; f < 6; f++) {
                const e = f % 3;
                0 === e ? (r.up.set(0, s[f], 0), r.position.set(a.x, a.y, a.z), r.lookAt(a.x + o[f], a.y, a.z)) : 1 === e ? (r.up.set(0, 0, s[f]), r.position.set(a.x, a.y, a.z), r.lookAt(a.x, a.y + o[f], a.z)) : (r.up.set(0, s[f], 0), r.position.set(a.x, a.y, a.z), r.lookAt(a.x, a.y, a.z + o[f]));
                const n = this._cubeSize;
                Fa(i, e * n, f > 2 ? n : 0, n, n), l.setRenderTarget(i), p && l.render(u, r), l.render(t, r)
            }
            l.toneMapping = h, l.autoClear = c, t.background = m
        }
        _textureToCubeUV(t, e) {
            const n = this._renderer,
                i = 301 === t.mapping || 302 === t.mapping;
            i ? (null === this._cubemapMaterial && (this._cubemapMaterial = za()), this._cubemapMaterial.uniforms.flipEnvMap.value = !1 === t.isRenderTargetTexture ? -1 : 1) : null === this._equirectMaterial && (this._equirectMaterial = Ba());
            const a = i ? this._cubemapMaterial : this._equirectMaterial,
                r = this._lodMeshes[0];
            r.material = a;
            a.uniforms.envMap.value = t;
            const s = this._cubeSize;
            Fa(e, 0, 0, 3 * s, 2 * s), n.setRenderTarget(e), n.render(r, Ra)
        }
        _applyPMREM(t) {
            const e = this._renderer,
                n = e.autoClear;
            e.autoClear = !1;
            const i = this._lodMeshes.length;
            for (let a = 1; a < i; a++) this._applyGGXFilter(t, a - 1, a);
            e.autoClear = n
        }
        _applyGGXFilter(t, e, n) {
            const i = this._renderer,
                a = this._pingPongRenderTarget,
                r = this._ggxMaterial,
                s = this._lodMeshes[n];
            s.material = r;
            const o = r.uniforms,
                l = n / (this._lodMeshes.length - 1),
                c = e / (this._lodMeshes.length - 1),
                h = Math.sqrt(l * l - c * c) * (0 + 1.25 * l),
                {
                    _lodMax: u
                } = this,
                d = this._sizeLods[n],
                p = 3 * d * (n > u - 4 ? n - u + 4 : 0),
                m = 4 * (this._cubeSize - d);
            o.envMap.value = t.texture, o.roughness.value = h, o.mipInt.value = u - e, Fa(a, p, m, 3 * d, 2 * d), i.setRenderTarget(a), i.render(s, Ra), o.envMap.value = a.texture, o.roughness.value = 0, o.mipInt.value = u - n, Fa(t, p, m, 3 * d, 2 * d), i.setRenderTarget(t), i.render(s, Ra)
        }
        _blur(t, e, n, i, a) {
            const r = this._pingPongRenderTarget;
            this._halfBlur(t, r, e, n, i, "latitudinal", a), this._halfBlur(r, t, n, n, i, "longitudinal", a)
        }
        _halfBlur(t, e, n, i, a, r, s) {
            const o = this._renderer,
                l = this._blurMaterial;
            "latitudinal" !== r && "longitudinal" !== r && H("blur direction must be either latitudinal or longitudinal!");
            const c = this._lodMeshes[i];
            c.material = l;
            const h = l.uniforms,
                u = this._sizeLods[n] - 1,
                d = isFinite(a) ? Math.PI / (2 * u) : 2 * Math.PI / 39,
                p = a / d,
                m = isFinite(a) ? 1 + Math.floor(3 * p) : Aa;
            m > Aa && k(`sigmaRadians, ${a}, is too large and will clip, as it requested ${m} samples when the maximum is set to 20`);
            const f = [];
            let g = 0;
            for (let x = 0; x < Aa; ++x) {
                const t = x / p,
                    e = Math.exp(-t * t / 2);
                f.push(e), 0 === x ? g += e : x < m && (g += 2 * e)
            }
            for (let x = 0; x < f.length; x++) f[x] = f[x] / g;
            h.envMap.value = t.texture, h.samples.value = m, h.weights.value = f, h.latitudinal.value = "latitudinal" === r, s && (h.poleAxis.value = s);
            const {
                _lodMax: _
            } = this;
            h.dTheta.value = d, h.mipInt.value = _ - n;
            const v = this._sizeLods[i];
            Fa(e, 3 * v * (i > _ - 4 ? i - _ + 4 : 0), 4 * (this._cubeSize - v), 3 * v, 2 * v), o.setRenderTarget(e), o.render(c, Ra)
        }
    };

function Oa(t, e, n) {
    const i = new wt(t, e, n);
    return i.texture.mapping = 306, i.texture.name = "PMREM.cubeUv", i.scissorTest = !0, i
}

function Fa(t, e, n, i, a) {
    t.viewport.set(e, n, i, a), t.scissor.set(e, n, i, a)
}

function Ba() {
    return new _i({
        name: "EquirectangularToCubeUV",
        uniforms: {
            envMap: {
                value: null
            }
        },
        vertexShader: Va(),
        fragmentShader: "\n\n\t\t\tprecision mediump float;\n\t\t\tprecision mediump int;\n\n\t\t\tvarying vec3 vOutputDirection;\n\n\t\t\tuniform sampler2D envMap;\n\n\t\t\t#include <common>\n\n\t\t\tvoid main() {\n\n\t\t\t\tvec3 outputDirection = normalize( vOutputDirection );\n\t\t\t\tvec2 uv = equirectUv( outputDirection );\n\n\t\t\t\tgl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );\n\n\t\t\t}\n\t\t",
        blending: 0,
        depthTest: !1,
        depthWrite: !1
    })
}

function za() {
    return new _i({
        name: "CubemapToCubeUV",
        uniforms: {
            envMap: {
                value: null
            },
            flipEnvMap: {
                value: -1
            }
        },
        vertexShader: Va(),
        fragmentShader: "\n\n\t\t\tprecision mediump float;\n\t\t\tprecision mediump int;\n\n\t\t\tuniform float flipEnvMap;\n\n\t\t\tvarying vec3 vOutputDirection;\n\n\t\t\tuniform samplerCube envMap;\n\n\t\t\tvoid main() {\n\n\t\t\t\tgl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );\n\n\t\t\t}\n\t\t",
        blending: 0,
        depthTest: !1,
        depthWrite: !1
    })
}

function Va() {
    return "\n\n\t\tprecision mediump float;\n\t\tprecision mediump int;\n\n\t\tattribute float faceIndex;\n\n\t\tvarying vec3 vOutputDirection;\n\n\t\t// RH coordinate system; PMREM face-indexing convention\n\t\tvec3 getDirection( vec2 uv, float face ) {\n\n\t\t\tuv = 2.0 * uv - 1.0;\n\n\t\t\tvec3 direction = vec3( uv, 1.0 );\n\n\t\t\tif ( face == 0.0 ) {\n\n\t\t\t\tdirection = direction.zyx; // ( 1, v, u ) pos x\n\n\t\t\t} else if ( face == 1.0 ) {\n\n\t\t\t\tdirection = direction.xzy;\n\t\t\t\tdirection.xz *= -1.0; // ( -u, 1, -v ) pos y\n\n\t\t\t} else if ( face == 2.0 ) {\n\n\t\t\t\tdirection.x *= -1.0; // ( -u, v, 1 ) pos z\n\n\t\t\t} else if ( face == 3.0 ) {\n\n\t\t\t\tdirection = direction.zyx;\n\t\t\t\tdirection.xz *= -1.0; // ( -1, v, -u ) neg x\n\n\t\t\t} else if ( face == 4.0 ) {\n\n\t\t\t\tdirection = direction.xzy;\n\t\t\t\tdirection.xy *= -1.0; // ( -u, -1, v ) neg y\n\n\t\t\t} else if ( face == 5.0 ) {\n\n\t\t\t\tdirection.z *= -1.0; // ( u, v, -1 ) neg z\n\n\t\t\t}\n\n\t\t\treturn direction;\n\n\t\t}\n\n\t\tvoid main() {\n\n\t\t\tvOutputDirection = getDirection( uv, faceIndex );\n\t\t\tgl_Position = vec4( position, 1.0 );\n\n\t\t}\n\t"
}
var ka = class extends wt {
    constructor(t = 1, e = {}) {
        super(t, t, e), this.isWebGLCubeRenderTarget = !0;
        const n = {
            width: t,
            height: t,
            depth: 1
        };
        this.texture = new si([n, n, n, n, n, n]), this._setTextureOptions(e), this.texture.isRenderTargetTexture = !0
    }
    fromEquirectangularTexture(t, e) {
        this.texture.type = e.type, this.texture.colorSpace = e.colorSpace, this.texture.generateMipmaps = e.generateMipmaps, this.texture.minFilter = e.minFilter, this.texture.magFilter = e.magFilter;
        const n = {
                uniforms: {
                    tEquirect: {
                        value: null
                    }
                },
                vertexShader: "\n\n\t\t\t\tvarying vec3 vWorldDirection;\n\n\t\t\t\tvec3 transformDirection( in vec3 dir, in mat4 matrix ) {\n\n\t\t\t\t\treturn normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );\n\n\t\t\t\t}\n\n\t\t\t\tvoid main() {\n\n\t\t\t\t\tvWorldDirection = transformDirection( position, modelMatrix );\n\n\t\t\t\t\t#include <begin_vertex>\n\t\t\t\t\t#include <project_vertex>\n\n\t\t\t\t}\n\t\t\t",
                fragmentShader: "\n\n\t\t\t\tuniform sampler2D tEquirect;\n\n\t\t\t\tvarying vec3 vWorldDirection;\n\n\t\t\t\t#include <common>\n\n\t\t\t\tvoid main() {\n\n\t\t\t\t\tvec3 direction = normalize( vWorldDirection );\n\n\t\t\t\t\tvec2 sampleUV = equirectUv( direction );\n\n\t\t\t\t\tgl_FragColor = texture2D( tEquirect, sampleUV );\n\n\t\t\t\t}\n\t\t\t"
            },
            i = new ui(5, 5, 5),
            a = new _i({
                name: "CubemapFromEquirect",
                uniforms: pi(n.uniforms),
                vertexShader: n.vertexShader,
                fragmentShader: n.fragmentShader,
                side: 1,
                blending: 0
            });
        a.uniforms.tEquirect.value = e;
        const r = new Zn(i, a),
            s = e.minFilter;
        return 1008 === e.minFilter && (e.minFilter = m), new Ji(1, 10, this).update(t, r), e.minFilter = s, r.geometry.dispose(), r.material.dispose(), this
    }
    clear(t, e = !0, n = !0, i = !0) {
        const a = t.getRenderTarget();
        for (let r = 0; r < 6; r++) t.setRenderTarget(this, r), t.clear(e, n, i);
        t.setRenderTarget(a)
    }
};

function Ha(t) {
    let e = new WeakMap,
        n = new WeakMap,
        i = null;

    function a(t, e) {
        return 303 === e ? t.mapping = 301 : 304 === e && (t.mapping = 302), t
    }

    function r(t) {
        const n = t.target;
        n.removeEventListener("dispose", r);
        const i = e.get(n);
        void 0 !== i && (e.delete(n), i.dispose())
    }

    function s(t) {
        const e = t.target;
        e.removeEventListener("dispose", s);
        const i = n.get(e);
        void 0 !== i && (n.delete(e), i.dispose())
    }
    return {
        get: function(o, l = !1) {
            return null == o ? null : l ? function(e) {
                if (e && e.isTexture) {
                    const a = e.mapping,
                        r = 303 === a || 304 === a,
                        o = 301 === a || 302 === a;
                    if (r || o) {
                        let a = n.get(e);
                        const l = void 0 !== a ? a.texture.pmremVersion : 0;
                        if (e.isRenderTargetTexture && e.pmremVersion !== l) return null === i && (i = new Na(t)), a = r ? i.fromEquirectangular(e, a) : i.fromCubemap(e, a), a.texture.pmremVersion = e.pmremVersion, n.set(e, a), a.texture;
                        if (void 0 !== a) return a.texture;
                        {
                            const l = e.image;
                            return r && l && l.height > 0 || o && l && function(t) {
                                let e = 0;
                                const n = 6;
                                for (let i = 0; i < n; i++) void 0 !== t[i] && e++;
                                return e === n
                            }(l) ? (null === i && (i = new Na(t)), a = r ? i.fromEquirectangular(e) : i.fromCubemap(e), a.texture.pmremVersion = e.pmremVersion, n.set(e, a), e.addEventListener("dispose", s), a.texture) : null
                        }
                    }
                }
                return e
            }(o) : function(n) {
                if (n && n.isTexture) {
                    const i = n.mapping;
                    if (303 === i || 304 === i) {
                        if (e.has(n)) {
                            return a(e.get(n).texture, n.mapping)
                        } {
                            const i = n.image;
                            if (i && i.height > 0) {
                                const s = new ka(i.height);
                                return s.fromEquirectangularTexture(t, n), e.set(n, s), n.addEventListener("dispose", r), a(s.texture, n.mapping)
                            }
                            return null
                        }
                    }
                }
                return n
            }(o)
        },
        dispose: function() {
            e = new WeakMap, n = new WeakMap, null !== i && (i.dispose(), i = null)
        }
    }
}

function Ga(t) {
    const e = {};

    function n(n) {
        if (void 0 !== e[n]) return e[n];
        const i = t.getExtension(n);
        return e[n] = i, i
    }
    return {
        has: function(t) {
            return null !== n(t)
        },
        init: function() {
            n("EXT_color_buffer_float"), n("WEBGL_clip_cull_distance"), n("OES_texture_float_linear"), n("EXT_color_buffer_half_float"), n("WEBGL_multisampled_render_to_texture"), n("WEBGL_render_shared_exponent")
        },
        get: function(t) {
            const e = n(t);
            return null === e && G("WebGLRenderer: " + t + " extension not supported."), e
        }
    }
}

function Wa(t, e, n, i) {
    const a = {},
        r = new WeakMap;

    function s(t) {
        const o = t.target;
        null !== o.index && e.remove(o.index);
        for (const n in o.attributes) e.remove(o.attributes[n]);
        o.removeEventListener("dispose", s), delete a[o.id];
        const l = r.get(o);
        l && (e.remove(l), r.delete(o)), i.releaseStatesOfGeometry(o), !0 === o.isInstancedBufferGeometry && delete o._maxInstanceCount, n.memory.geometries--
    }

    function o(t) {
        const n = [],
            i = t.index,
            a = t.attributes.position;
        let s = 0;
        if (void 0 === a) return;
        if (null !== i) {
            const t = i.array;
            s = i.version;
            for (let e = 0, i = t.length; e < i; e += 3) {
                const i = t[e + 0],
                    a = t[e + 1],
                    r = t[e + 2];
                n.push(i, a, a, r, r, i)
            }
        } else {
            const t = a.array;
            s = a.version;
            for (let e = 0, i = t.length / 3 - 1; e < i; e += 3) {
                const t = e + 0,
                    i = e + 1,
                    a = e + 2;
                n.push(t, i, i, a, a, t)
            }
        }
        const o = new(a.count >= 65535 ? qe : je)(n, 1);
        o.version = s;
        const l = r.get(t);
        l && e.remove(l), r.set(t, o)
    }
    return {
        get: function(t, e) {
            return !0 === a[e.id] || (e.addEventListener("dispose", s), a[e.id] = !0, n.memory.geometries++), e
        },
        update: function(n) {
            const i = n.attributes;
            for (const a in i) e.update(i[a], t.ARRAY_BUFFER)
        },
        getWireframeAttribute: function(t) {
            const e = r.get(t);
            if (e) {
                const n = t.index;
                null !== n && e.version < n.version && o(t)
            } else o(t);
            return r.get(t)
        }
    }
}

function Xa(t, e, n) {
    let i, a, r;

    function s(e, s, o) {
        0 !== o && (t.drawElementsInstanced(i, s, a, e * r, o), n.update(s, i, o))
    }
    this.setMode = function(t) {
        i = t
    }, this.setIndex = function(t) {
        a = t.type, r = t.bytesPerElement
    }, this.render = function(e, s) {
        t.drawElements(i, s, a, e * r), n.update(s, i, 1)
    }, this.renderInstances = s, this.renderMultiDraw = function(t, r, s) {
        if (0 === s) return;
        e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(i, r, 0, a, t, 0, s);
        let o = 0;
        for (let e = 0; e < s; e++) o += r[e];
        n.update(o, i, 1)
    }, this.renderMultiDrawInstances = function(t, o, l, c) {
        if (0 === l) return;
        const h = e.get("WEBGL_multi_draw");
        if (null === h)
            for (let e = 0; e < t.length; e++) s(t[e] / r, o[e], c[e]);
        else {
            h.multiDrawElementsInstancedWEBGL(i, o, 0, a, t, 0, c, 0, l);
            let e = 0;
            for (let t = 0; t < l; t++) e += o[t] * c[t];
            n.update(e, i, 1)
        }
    }
}

function Ya(t) {
    const e = {
        frame: 0,
        calls: 0,
        triangles: 0,
        points: 0,
        lines: 0
    };
    return {
        memory: {
            geometries: 0,
            textures: 0
        },
        render: e,
        programs: null,
        autoReset: !0,
        reset: function() {
            e.calls = 0, e.triangles = 0, e.points = 0, e.lines = 0
        },
        update: function(n, i, a) {
            switch (e.calls++, i) {
                case t.TRIANGLES:
                    e.triangles += a * (n / 3);
                    break;
                case t.LINES:
                    e.lines += a * (n / 2);
                    break;
                case t.LINE_STRIP:
                    e.lines += a * (n - 1);
                    break;
                case t.LINE_LOOP:
                    e.lines += a * n;
                    break;
                case t.POINTS:
                    e.points += a * n;
                    break;
                default:
                    H("WebGLInfo: Unknown draw mode:", i)
            }
        }
    }
}

function ja(t, e, n) {
    const i = new WeakMap,
        a = new Et;
    return {
        update: function(r, s, o) {
            const l = r.morphTargetInfluences,
                c = s.morphAttributes.position || s.morphAttributes.normal || s.morphAttributes.color,
                h = void 0 !== c ? c.length : 0;
            let u = i.get(s);
            if (void 0 === u || u.count !== h) {
                void 0 !== u && u.texture.dispose();
                const d = void 0 !== s.morphAttributes.position,
                    p = void 0 !== s.morphAttributes.normal,
                    m = void 0 !== s.morphAttributes.color,
                    f = s.morphAttributes.position || [],
                    g = s.morphAttributes.normal || [],
                    _ = s.morphAttributes.color || [];
                let v = 0;
                !0 === d && (v = 1), !0 === p && (v = 2), !0 === m && (v = 3);
                let x = s.attributes.position.count * v,
                    b = 1;
                x > e.maxTextureSize && (b = Math.ceil(x / e.maxTextureSize), x = e.maxTextureSize);
                const y = new Float32Array(x * b * 4 * h),
                    S = new At(y, x, b, h);
                S.type = M, S.needsUpdate = !0;
                const E = 4 * v;
                for (let w = 0; w < h; w++) {
                    const A = f[w],
                        R = g[w],
                        C = _[w],
                        P = x * b * 4 * w;
                    for (let D = 0; D < A.count; D++) {
                        const L = D * E;
                        !0 === d && (a.fromBufferAttribute(A, D), y[P + L + 0] = a.x, y[P + L + 1] = a.y, y[P + L + 2] = a.z, y[P + L + 3] = 0), !0 === p && (a.fromBufferAttribute(R, D), y[P + L + 4] = a.x, y[P + L + 5] = a.y, y[P + L + 6] = a.z, y[P + L + 7] = 0), !0 === m && (a.fromBufferAttribute(C, D), y[P + L + 8] = a.x, y[P + L + 9] = a.y, y[P + L + 10] = a.z, y[P + L + 11] = 4 === C.itemSize ? a.w : 1)
                    }
                }

                function T() {
                    S.dispose(), i.delete(s), s.removeEventListener("dispose", T)
                }
                u = {
                    count: h,
                    texture: S,
                    size: new it(x, b)
                }, i.set(s, u), s.addEventListener("dispose", T)
            }
            if (!0 === r.isInstancedMesh && null !== r.morphTexture) o.getUniforms().setValue(t, "morphTexture", r.morphTexture, n);
            else {
                let I = 0;
                for (let N = 0; N < l.length; N++) I += l[N];
                const U = s.morphTargetsRelative ? 1 : 1 - I;
                o.getUniforms().setValue(t, "morphTargetBaseInfluence", U), o.getUniforms().setValue(t, "morphTargetInfluences", l)
            }
            o.getUniforms().setValue(t, "morphTargetsTexture", u.texture, n), o.getUniforms().setValue(t, "morphTargetsTextureSize", u.size)
        }
    }
}

function qa(t, e, n, i, a) {
    let r = new WeakMap;

    function s(t) {
        const e = t.target;
        e.removeEventListener("dispose", s), i.releaseStatesOfObject(e), n.remove(e.instanceMatrix), null !== e.instanceColor && n.remove(e.instanceColor)
    }
    return {
        update: function(i) {
            const o = a.render.frame,
                l = i.geometry,
                c = e.get(i, l);
            if (r.get(c) !== o && (e.update(c), r.set(c, o)), i.isInstancedMesh && (!1 === i.hasEventListener("dispose", s) && i.addEventListener("dispose", s), r.get(i) !== o && (n.update(i.instanceMatrix, t.ARRAY_BUFFER), null !== i.instanceColor && n.update(i.instanceColor, t.ARRAY_BUFFER), r.set(i, o))), i.isSkinnedMesh) {
                const t = i.skeleton;
                r.get(t) !== o && (t.update(), r.set(t, o))
            }
            return c
        },
        dispose: function() {
            r = new WeakMap
        }
    }
}
var Za = {
    1: "LINEAR_TONE_MAPPING",
    2: "REINHARD_TONE_MAPPING",
    3: "CINEON_TONE_MAPPING",
    4: "ACES_FILMIC_TONE_MAPPING",
    6: "AGX_TONE_MAPPING",
    7: "NEUTRAL_TONE_MAPPING",
    5: "CUSTOM_TONE_MAPPING"
};

function Ka(t, e, n, i, a) {
    const r = new wt(e, n, {
            type: t,
            depthBuffer: i,
            stencilBuffer: a
        }),
        s = new wt(e, n, {
            type: b,
            depthBuffer: !1,
            stencilBuffer: !1
        }),
        o = new ln;
    o.setAttribute("position", new Ze([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3)), o.setAttribute("uv", new Ze([0, 2, 0, 0, 2, 0], 2));
    const l = new vi({
            uniforms: {
                tDiffuse: {
                    value: null
                }
            },
            vertexShader: "\n\t\t\tprecision highp float;\n\n\t\t\tuniform mat4 modelViewMatrix;\n\t\t\tuniform mat4 projectionMatrix;\n\n\t\t\tattribute vec3 position;\n\t\t\tattribute vec2 uv;\n\n\t\t\tvarying vec2 vUv;\n\n\t\t\tvoid main() {\n\t\t\t\tvUv = uv;\n\t\t\t\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n\t\t\t}",
            fragmentShader: "\n\t\t\tprecision highp float;\n\n\t\t\tuniform sampler2D tDiffuse;\n\n\t\t\tvarying vec2 vUv;\n\n\t\t\t#include <tonemapping_pars_fragment>\n\t\t\t#include <colorspace_pars_fragment>\n\n\t\t\tvoid main() {\n\t\t\t\tgl_FragColor = texture2D( tDiffuse, vUv );\n\n\t\t\t\t#ifdef LINEAR_TONE_MAPPING\n\t\t\t\t\tgl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );\n\t\t\t\t#elif defined( REINHARD_TONE_MAPPING )\n\t\t\t\t\tgl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );\n\t\t\t\t#elif defined( CINEON_TONE_MAPPING )\n\t\t\t\t\tgl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );\n\t\t\t\t#elif defined( ACES_FILMIC_TONE_MAPPING )\n\t\t\t\t\tgl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );\n\t\t\t\t#elif defined( AGX_TONE_MAPPING )\n\t\t\t\t\tgl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );\n\t\t\t\t#elif defined( NEUTRAL_TONE_MAPPING )\n\t\t\t\t\tgl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );\n\t\t\t\t#elif defined( CUSTOM_TONE_MAPPING )\n\t\t\t\t\tgl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );\n\t\t\t\t#endif\n\n\t\t\t\t#ifdef SRGB_TRANSFER\n\t\t\t\t\tgl_FragColor = sRGBTransferOETF( gl_FragColor );\n\t\t\t\t#endif\n\t\t\t}",
            depthTest: !1,
            depthWrite: !1
        }),
        c = new Zn(o, l),
        h = new Yi(-1, 1, 1, -1, 0, 1);
    let u, d = null,
        p = null,
        m = !1,
        f = null,
        g = [],
        _ = !1;
    this.setSize = function(t, e) {
        r.setSize(t, e), s.setSize(t, e);
        for (let n = 0; n < g.length; n++) {
            const i = g[n];
            i.setSize && i.setSize(t, e)
        }
    }, this.setEffects = function(t) {
        g = t, _ = g.length > 0 && !0 === g[0].isRenderPass;
        const e = r.width,
            n = r.height;
        for (let i = 0; i < g.length; i++) {
            const t = g[i];
            t.setSize && t.setSize(e, n)
        }
    }, this.begin = function(t, e) {
        if (m) return !1;
        if (0 === t.toneMapping && 0 === g.length) return !1;
        if (f = e, null !== e) {
            const t = e.width,
                n = e.height;
            r.width === t && r.height === n || this.setSize(t, n)
        }
        return !1 === _ && t.setRenderTarget(r), u = t.toneMapping, t.toneMapping = 0, !0
    }, this.hasRenderPass = function() {
        return _
    }, this.end = function(t, e) {
        t.toneMapping = u, m = !0;
        let n = r,
            i = s;
        for (let a = 0; a < g.length; a++) {
            const r = g[a];
            if (!1 !== r.enabled && (r.render(t, i, n, e), !1 !== r.needsSwap)) {
                const t = n;
                n = i, i = t
            }
        }
        if (d !== t.outputColorSpace || p !== t.toneMapping) {
            d = t.outputColorSpace, p = t.toneMapping, l.defines = {}, "srgb" === mt.getTransfer(d) && (l.defines.SRGB_TRANSFER = "");
            const e = Za[p];
            e && (l.defines[e] = ""), l.needsUpdate = !0
        }
        l.uniforms.tDiffuse.value = n.texture, t.setRenderTarget(f), t.render(c, h), f = null, m = !1
    }, this.isCompositing = function() {
        return m
    }, this.dispose = function() {
        r.dispose(), s.dispose(), o.dispose(), l.dispose()
    }
}
var Ja = new St,
    $a = new li(1, 1),
    Qa = new At,
    tr = new Rt,
    er = new si,
    nr = [],
    ir = [],
    ar = new Float32Array(16),
    rr = new Float32Array(9),
    sr = new Float32Array(4);

function or(t, e, n) {
    const i = t[0];
    if (i <= 0 || i > 0) return t;
    const a = e * n;
    let r = nr[a];
    if (void 0 === r && (r = new Float32Array(a), nr[a] = r), 0 !== e) {
        i.toArray(r, 0);
        for (let i = 1, a = 0; i !== e; ++i) a += n, t[i].toArray(r, a)
    }
    return r
}

function lr(t, e) {
    if (t.length !== e.length) return !1;
    for (let n = 0, i = t.length; n < i; n++)
        if (t[n] !== e[n]) return !1;
    return !0
}

function cr(t, e) {
    for (let n = 0, i = e.length; n < i; n++) t[n] = e[n]
}

function hr(t, e) {
    let n = ir[e];
    void 0 === n && (n = new Int32Array(e), ir[e] = n);
    for (let i = 0; i !== e; ++i) n[i] = t.allocateTextureUnit();
    return n
}

function ur(t, e) {
    const n = this.cache;
    n[0] !== e && (t.uniform1f(this.addr, e), n[0] = e)
}

function dr(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y || (t.uniform2f(this.addr, e.x, e.y), n[0] = e.x, n[1] = e.y);
    else {
        if (lr(n, e)) return;
        t.uniform2fv(this.addr, e), cr(n, e)
    }
}

function pr(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y && n[2] === e.z || (t.uniform3f(this.addr, e.x, e.y, e.z), n[0] = e.x, n[1] = e.y, n[2] = e.z);
    else if (void 0 !== e.r) n[0] === e.r && n[1] === e.g && n[2] === e.b || (t.uniform3f(this.addr, e.r, e.g, e.b), n[0] = e.r, n[1] = e.g, n[2] = e.b);
    else {
        if (lr(n, e)) return;
        t.uniform3fv(this.addr, e), cr(n, e)
    }
}

function mr(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y && n[2] === e.z && n[3] === e.w || (t.uniform4f(this.addr, e.x, e.y, e.z, e.w), n[0] = e.x, n[1] = e.y, n[2] = e.z, n[3] = e.w);
    else {
        if (lr(n, e)) return;
        t.uniform4fv(this.addr, e), cr(n, e)
    }
}

function fr(t, e) {
    const n = this.cache,
        i = e.elements;
    if (void 0 === i) {
        if (lr(n, e)) return;
        t.uniformMatrix2fv(this.addr, !1, e), cr(n, e)
    } else {
        if (lr(n, i)) return;
        sr.set(i), t.uniformMatrix2fv(this.addr, !1, sr), cr(n, i)
    }
}

function gr(t, e) {
    const n = this.cache,
        i = e.elements;
    if (void 0 === i) {
        if (lr(n, e)) return;
        t.uniformMatrix3fv(this.addr, !1, e), cr(n, e)
    } else {
        if (lr(n, i)) return;
        rr.set(i), t.uniformMatrix3fv(this.addr, !1, rr), cr(n, i)
    }
}

function _r(t, e) {
    const n = this.cache,
        i = e.elements;
    if (void 0 === i) {
        if (lr(n, e)) return;
        t.uniformMatrix4fv(this.addr, !1, e), cr(n, e)
    } else {
        if (lr(n, i)) return;
        ar.set(i), t.uniformMatrix4fv(this.addr, !1, ar), cr(n, i)
    }
}

function vr(t, e) {
    const n = this.cache;
    n[0] !== e && (t.uniform1i(this.addr, e), n[0] = e)
}

function xr(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y || (t.uniform2i(this.addr, e.x, e.y), n[0] = e.x, n[1] = e.y);
    else {
        if (lr(n, e)) return;
        t.uniform2iv(this.addr, e), cr(n, e)
    }
}

function Mr(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y && n[2] === e.z || (t.uniform3i(this.addr, e.x, e.y, e.z), n[0] = e.x, n[1] = e.y, n[2] = e.z);
    else {
        if (lr(n, e)) return;
        t.uniform3iv(this.addr, e), cr(n, e)
    }
}

function br(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y && n[2] === e.z && n[3] === e.w || (t.uniform4i(this.addr, e.x, e.y, e.z, e.w), n[0] = e.x, n[1] = e.y, n[2] = e.z, n[3] = e.w);
    else {
        if (lr(n, e)) return;
        t.uniform4iv(this.addr, e), cr(n, e)
    }
}

function yr(t, e) {
    const n = this.cache;
    n[0] !== e && (t.uniform1ui(this.addr, e), n[0] = e)
}

function Sr(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y || (t.uniform2ui(this.addr, e.x, e.y), n[0] = e.x, n[1] = e.y);
    else {
        if (lr(n, e)) return;
        t.uniform2uiv(this.addr, e), cr(n, e)
    }
}

function Er(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y && n[2] === e.z || (t.uniform3ui(this.addr, e.x, e.y, e.z), n[0] = e.x, n[1] = e.y, n[2] = e.z);
    else {
        if (lr(n, e)) return;
        t.uniform3uiv(this.addr, e), cr(n, e)
    }
}

function Tr(t, e) {
    const n = this.cache;
    if (void 0 !== e.x) n[0] === e.x && n[1] === e.y && n[2] === e.z && n[3] === e.w || (t.uniform4ui(this.addr, e.x, e.y, e.z, e.w), n[0] = e.x, n[1] = e.y, n[2] = e.z, n[3] = e.w);
    else {
        if (lr(n, e)) return;
        t.uniform4uiv(this.addr, e), cr(n, e)
    }
}

function wr(t, e, n) {
    const i = this.cache,
        a = n.allocateTextureUnit();
    let r;
    i[0] !== a && (t.uniform1i(this.addr, a), i[0] = a), this.type === t.SAMPLER_2D_SHADOW ? ($a.compareFunction = n.isReversedDepthBuffer() ? 518 : 515, r = $a) : r = Ja, n.setTexture2D(e || r, a)
}

function Ar(t, e, n) {
    const i = this.cache,
        a = n.allocateTextureUnit();
    i[0] !== a && (t.uniform1i(this.addr, a), i[0] = a), n.setTexture3D(e || tr, a)
}

function Rr(t, e, n) {
    const i = this.cache,
        a = n.allocateTextureUnit();
    i[0] !== a && (t.uniform1i(this.addr, a), i[0] = a), n.setTextureCube(e || er, a)
}

function Cr(t, e, n) {
    const i = this.cache,
        a = n.allocateTextureUnit();
    i[0] !== a && (t.uniform1i(this.addr, a), i[0] = a), n.setTexture2DArray(e || Qa, a)
}

function Pr(t, e) {
    t.uniform1fv(this.addr, e)
}

function Dr(t, e) {
    const n = or(e, this.size, 2);
    t.uniform2fv(this.addr, n)
}

function Lr(t, e) {
    const n = or(e, this.size, 3);
    t.uniform3fv(this.addr, n)
}

function Ir(t, e) {
    const n = or(e, this.size, 4);
    t.uniform4fv(this.addr, n)
}

function Ur(t, e) {
    const n = or(e, this.size, 4);
    t.uniformMatrix2fv(this.addr, !1, n)
}

function Nr(t, e) {
    const n = or(e, this.size, 9);
    t.uniformMatrix3fv(this.addr, !1, n)
}

function Or(t, e) {
    const n = or(e, this.size, 16);
    t.uniformMatrix4fv(this.addr, !1, n)
}

function Fr(t, e) {
    t.uniform1iv(this.addr, e)
}

function Br(t, e) {
    t.uniform2iv(this.addr, e)
}

function zr(t, e) {
    t.uniform3iv(this.addr, e)
}

function Vr(t, e) {
    t.uniform4iv(this.addr, e)
}

function kr(t, e) {
    t.uniform1uiv(this.addr, e)
}

function Hr(t, e) {
    t.uniform2uiv(this.addr, e)
}

function Gr(t, e) {
    t.uniform3uiv(this.addr, e)
}

function Wr(t, e) {
    t.uniform4uiv(this.addr, e)
}

function Xr(t, e, n) {
    const i = this.cache,
        a = e.length,
        r = hr(n, a);
    let s;
    lr(i, r) || (t.uniform1iv(this.addr, r), cr(i, r)), s = this.type === t.SAMPLER_2D_SHADOW ? $a : Ja;
    for (let o = 0; o !== a; ++o) n.setTexture2D(e[o] || s, r[o])
}

function Yr(t, e, n) {
    const i = this.cache,
        a = e.length,
        r = hr(n, a);
    lr(i, r) || (t.uniform1iv(this.addr, r), cr(i, r));
    for (let s = 0; s !== a; ++s) n.setTexture3D(e[s] || tr, r[s])
}

function jr(t, e, n) {
    const i = this.cache,
        a = e.length,
        r = hr(n, a);
    lr(i, r) || (t.uniform1iv(this.addr, r), cr(i, r));
    for (let s = 0; s !== a; ++s) n.setTextureCube(e[s] || er, r[s])
}

function qr(t, e, n) {
    const i = this.cache,
        a = e.length,
        r = hr(n, a);
    lr(i, r) || (t.uniform1iv(this.addr, r), cr(i, r));
    for (let s = 0; s !== a; ++s) n.setTexture2DArray(e[s] || Qa, r[s])
}
var Zr = class {
        constructor(t, e, n) {
            this.id = t, this.addr = n, this.cache = [], this.type = e.type, this.setValue = function(t) {
                switch (t) {
                    case 5126:
                        return ur;
                    case 35664:
                        return dr;
                    case 35665:
                        return pr;
                    case 35666:
                        return mr;
                    case 35674:
                        return fr;
                    case 35675:
                        return gr;
                    case 35676:
                        return _r;
                    case 5124:
                    case 35670:
                        return vr;
                    case 35667:
                    case 35671:
                        return xr;
                    case 35668:
                    case 35672:
                        return Mr;
                    case 35669:
                    case 35673:
                        return br;
                    case 5125:
                        return yr;
                    case 36294:
                        return Sr;
                    case 36295:
                        return Er;
                    case 36296:
                        return Tr;
                    case 35678:
                    case 36198:
                    case 36298:
                    case 36306:
                    case 35682:
                        return wr;
                    case 35679:
                    case 36299:
                    case 36307:
                        return Ar;
                    case 35680:
                    case 36300:
                    case 36308:
                    case 36293:
                        return Rr;
                    case 36289:
                    case 36303:
                    case 36311:
                    case 36292:
                        return Cr
                }
            }(e.type)
        }
    },
    Kr = class {
        constructor(t, e, n) {
            this.id = t, this.addr = n, this.cache = [], this.type = e.type, this.size = e.size, this.setValue = function(t) {
                switch (t) {
                    case 5126:
                        return Pr;
                    case 35664:
                        return Dr;
                    case 35665:
                        return Lr;
                    case 35666:
                        return Ir;
                    case 35674:
                        return Ur;
                    case 35675:
                        return Nr;
                    case 35676:
                        return Or;
                    case 5124:
                    case 35670:
                        return Fr;
                    case 35667:
                    case 35671:
                        return Br;
                    case 35668:
                    case 35672:
                        return zr;
                    case 35669:
                    case 35673:
                        return Vr;
                    case 5125:
                        return kr;
                    case 36294:
                        return Hr;
                    case 36295:
                        return Gr;
                    case 36296:
                        return Wr;
                    case 35678:
                    case 36198:
                    case 36298:
                    case 36306:
                    case 35682:
                        return Xr;
                    case 35679:
                    case 36299:
                    case 36307:
                        return Yr;
                    case 35680:
                    case 36300:
                    case 36308:
                    case 36293:
                        return jr;
                    case 36289:
                    case 36303:
                    case 36311:
                    case 36292:
                        return qr
                }
            }(e.type)
        }
    },
    Jr = class {
        constructor(t) {
            this.id = t, this.seq = [], this.map = {}
        }
        setValue(t, e, n) {
            const i = this.seq;
            for (let a = 0, r = i.length; a !== r; ++a) {
                const r = i[a];
                r.setValue(t, e[r.id], n)
            }
        }
    },
    $r = /(\w+)(\])?(\[|\.)?/g;

function Qr(t, e) {
    t.seq.push(e), t.map[e.id] = e
}

function ts(t, e, n) {
    const i = t.name,
        a = i.length;
    for ($r.lastIndex = 0;;) {
        const r = $r.exec(i),
            s = $r.lastIndex;
        let o = r[1];
        const l = "]" === r[2],
            c = r[3];
        if (l && (o |= 0), void 0 === c || "[" === c && s + 2 === a) {
            Qr(n, void 0 === c ? new Zr(o, t, e) : new Kr(o, t, e));
            break
        } {
            let t = n.map[o];
            void 0 === t && (t = new Jr(o), Qr(n, t)), n = t
        }
    }
}
var es = class {
    constructor(t, e) {
        this.seq = [], this.map = {};
        const n = t.getProgramParameter(e, t.ACTIVE_UNIFORMS);
        for (let r = 0; r < n; ++r) {
            const n = t.getActiveUniform(e, r);
            ts(n, t.getUniformLocation(e, n.name), this)
        }
        const i = [],
            a = [];
        for (const r of this.seq) r.type === t.SAMPLER_2D_SHADOW || r.type === t.SAMPLER_CUBE_SHADOW || r.type === t.SAMPLER_2D_ARRAY_SHADOW ? i.push(r) : a.push(r);
        i.length > 0 && (this.seq = i.concat(a))
    }
    setValue(t, e, n, i) {
        const a = this.map[e];
        void 0 !== a && a.setValue(t, n, i)
    }
    setOptional(t, e, n) {
        const i = e[n];
        void 0 !== i && this.setValue(t, n, i)
    }
    static upload(t, e, n, i) {
        for (let a = 0, r = e.length; a !== r; ++a) {
            const r = e[a],
                s = n[r.id];
            !1 !== s.needsUpdate && r.setValue(t, s.value, i)
        }
    }
    static seqWithValue(t, e) {
        const n = [];
        for (let i = 0, a = t.length; i !== a; ++i) {
            const a = t[i];
            a.id in e && n.push(a)
        }
        return n
    }
};

function ns(t, e, n) {
    const i = t.createShader(e);
    return t.shaderSource(i, n), t.compileShader(i), i
}
var is = 0;
var as = new lt;

function rs(t, e, n) {
    const i = t.getShaderParameter(e, t.COMPILE_STATUS),
        a = (t.getShaderInfoLog(e) || "").trim();
    if (i && "" === a) return "";
    const r = /ERROR: 0:(\d+)/.exec(a);
    if (r) {
        const i = parseInt(r[1]);
        return n.toUpperCase() + "\n\n" + a + "\n\n" + function(t, e) {
            const n = t.split("\n"),
                i = [],
                a = Math.max(e - 6, 0),
                r = Math.min(e + 6, n.length);
            for (let s = a; s < r; s++) {
                const t = s + 1;
                i.push(`${t===e?">":" "} ${t}: ${n[s]}`)
            }
            return i.join("\n")
        }(t.getShaderSource(e), i)
    }
    return a
}

function ss(t, e) {
    const n = function(t) {
        mt._getMatrix(as, mt.workingColorSpace, t);
        const e = `mat3( ${as.elements.map(t=>t.toFixed(4))} )`;
        switch (mt.getTransfer(t)) {
            case L:
                return [e, "LinearTransferOETF"];
            case I:
                return [e, "sRGBTransferOETF"];
            default:
                return k("WebGLProgram: Unsupported color space: ", t), [e, "LinearTransferOETF"]
        }
    }(e);
    return [`vec4 ${t}( vec4 value ) {`, `\treturn ${n[1]}( vec4( value.rgb * ${n[0]}, value.a ) );`, "}"].join("\n")
}
var os = {
    1: "Linear",
    2: "Reinhard",
    3: "Cineon",
    4: "ACESFilmic",
    6: "AgX",
    7: "Neutral",
    5: "Custom"
};

function ls(t, e) {
    const n = os[e];
    return void 0 === n ? (k("WebGLProgram: Unsupported toneMapping:", e), "vec3 " + t + "( vec3 color ) { return LinearToneMapping( color ); }") : "vec3 " + t + "( vec3 color ) { return " + n + "ToneMapping( color ); }"
}
var cs = new rt;

function hs(t) {
    return "" !== t
}

function us(t, e) {
    const n = e.numSpotLightShadows + e.numSpotLightMaps - e.numSpotLightShadowsWithMaps;
    return t.replace(/NUM_DIR_LIGHTS/g, e.numDirLights).replace(/NUM_SPOT_LIGHTS/g, e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g, e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g, n).replace(/NUM_RECT_AREA_LIGHTS/g, e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g, e.numPointLights).replace(/NUM_HEMI_LIGHTS/g, e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g, e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g, e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g, e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g, e.numPointLightShadows)
}

function ds(t, e) {
    return t.replace(/NUM_CLIPPING_PLANES/g, e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g, e.numClippingPlanes - e.numClipIntersection)
}
var ps = /^[ \t]*#include +<([\w\d./]+)>/gm;

function ms(t) {
    return t.replace(ps, gs)
}
var fs = new Map;

function gs(t, e) {
    let n = fa[e];
    if (void 0 === n) {
        const t = fs.get(e);
        if (void 0 === t) throw new Error("Can not resolve #include <" + e + ">");
        n = fa[t], k('WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.', e, t)
    }
    return ms(n)
}
var _s = /#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;

function vs(t) {
    return t.replace(_s, xs)
}

function xs(t, e, n, i) {
    let a = "";
    for (let r = parseInt(e); r < parseInt(n); r++) a += i.replace(/\[\s*i\s*\]/g, "[ " + r + " ]").replace(/UNROLLED_LOOP_INDEX/g, r);
    return a
}

function Ms(t) {
    let e = `precision ${t.precision} float;\n\tprecision ${t.precision} int;\n\tprecision ${t.precision} sampler2D;\n\tprecision ${t.precision} samplerCube;\n\tprecision ${t.precision} sampler3D;\n\tprecision ${t.precision} sampler2DArray;\n\tprecision ${t.precision} sampler2DShadow;\n\tprecision ${t.precision} samplerCubeShadow;\n\tprecision ${t.precision} sampler2DArrayShadow;\n\tprecision ${t.precision} isampler2D;\n\tprecision ${t.precision} isampler3D;\n\tprecision ${t.precision} isamplerCube;\n\tprecision ${t.precision} isampler2DArray;\n\tprecision ${t.precision} usampler2D;\n\tprecision ${t.precision} usampler3D;\n\tprecision ${t.precision} usamplerCube;\n\tprecision ${t.precision} usampler2DArray;\n\t`;
    return "highp" === t.precision ? e += "\n#define HIGH_PRECISION" : "mediump" === t.precision ? e += "\n#define MEDIUM_PRECISION" : "lowp" === t.precision && (e += "\n#define LOW_PRECISION"), e
}
var bs = {
    1: "SHADOWMAP_TYPE_PCF",
    3: "SHADOWMAP_TYPE_VSM"
};
var ys = {
    301: "ENVMAP_TYPE_CUBE",
    302: "ENVMAP_TYPE_CUBE",
    306: "ENVMAP_TYPE_CUBE_UV"
};
var Ss = {
    302: "ENVMAP_MODE_REFRACTION"
};
var Es = {
    0: "ENVMAP_BLENDING_MULTIPLY",
    1: "ENVMAP_BLENDING_MIX",
    2: "ENVMAP_BLENDING_ADD"
};

function Ts(t, e, n, i) {
    const a = t.getContext(),
        r = n.defines;
    let s = n.vertexShader,
        o = n.fragmentShader;
    const l = function(t) {
            return bs[t.shadowMapType] || "SHADOWMAP_TYPE_BASIC"
        }(n),
        c = function(t) {
            return !1 === t.envMap ? "ENVMAP_TYPE_CUBE" : ys[t.envMapMode] || "ENVMAP_TYPE_CUBE"
        }(n),
        h = function(t) {
            return !1 === t.envMap ? "ENVMAP_MODE_REFLECTION" : Ss[t.envMapMode] || "ENVMAP_MODE_REFLECTION"
        }(n),
        u = function(t) {
            return !1 === t.envMap ? "ENVMAP_BLENDING_NONE" : Es[t.combine] || "ENVMAP_BLENDING_NONE"
        }(n),
        d = function(t) {
            const e = t.envMapCubeUVHeight;
            if (null === e) return null;
            const n = Math.log2(e) - 2,
                i = 1 / e;
            return {
                texelWidth: 1 / (3 * Math.max(Math.pow(2, n), 112)),
                texelHeight: i,
                maxMip: n
            }
        }(n),
        p = function(t) {
            return [t.extensionClipCullDistance ? "#extension GL_ANGLE_clip_cull_distance : require" : "", t.extensionMultiDraw ? "#extension GL_ANGLE_multi_draw : require" : ""].filter(hs).join("\n")
        }(n),
        m = function(t) {
            const e = [];
            for (const n in t) {
                const i = t[n];
                !1 !== i && e.push("#define " + n + " " + i)
            }
            return e.join("\n")
        }(r),
        f = a.createProgram();
    let g, _, v = n.glslVersion ? "#version " + n.glslVersion + "\n" : "";
    n.isRawShaderMaterial ? (g = ["#define SHADER_TYPE " + n.shaderType, "#define SHADER_NAME " + n.shaderName, m].filter(hs).join("\n"), g.length > 0 && (g += "\n"), _ = ["#define SHADER_TYPE " + n.shaderType, "#define SHADER_NAME " + n.shaderName, m].filter(hs).join("\n"), _.length > 0 && (_ += "\n")) : (g = [Ms(n), "#define SHADER_TYPE " + n.shaderType, "#define SHADER_NAME " + n.shaderName, m, n.extensionClipCullDistance ? "#define USE_CLIP_DISTANCE" : "", n.batching ? "#define USE_BATCHING" : "", n.batchingColor ? "#define USE_BATCHING_COLOR" : "", n.instancing ? "#define USE_INSTANCING" : "", n.instancingColor ? "#define USE_INSTANCING_COLOR" : "", n.instancingMorph ? "#define USE_INSTANCING_MORPH" : "", n.useFog && n.fog ? "#define USE_FOG" : "", n.useFog && n.fogExp2 ? "#define FOG_EXP2" : "", n.map ? "#define USE_MAP" : "", n.envMap ? "#define USE_ENVMAP" : "", n.envMap ? "#define " + h : "", n.lightMap ? "#define USE_LIGHTMAP" : "", n.aoMap ? "#define USE_AOMAP" : "", n.bumpMap ? "#define USE_BUMPMAP" : "", n.normalMap ? "#define USE_NORMALMAP" : "", n.normalMapObjectSpace ? "#define USE_NORMALMAP_OBJECTSPACE" : "", n.normalMapTangentSpace ? "#define USE_NORMALMAP_TANGENTSPACE" : "", n.displacementMap ? "#define USE_DISPLACEMENTMAP" : "", n.emissiveMap ? "#define USE_EMISSIVEMAP" : "", n.anisotropy ? "#define USE_ANISOTROPY" : "", n.anisotropyMap ? "#define USE_ANISOTROPYMAP" : "", n.clearcoatMap ? "#define USE_CLEARCOATMAP" : "", n.clearcoatRoughnessMap ? "#define USE_CLEARCOAT_ROUGHNESSMAP" : "", n.clearcoatNormalMap ? "#define USE_CLEARCOAT_NORMALMAP" : "", n.iridescenceMap ? "#define USE_IRIDESCENCEMAP" : "", n.iridescenceThicknessMap ? "#define USE_IRIDESCENCE_THICKNESSMAP" : "", n.specularMap ? "#define USE_SPECULARMAP" : "", n.specularColorMap ? "#define USE_SPECULAR_COLORMAP" : "", n.specularIntensityMap ? "#define USE_SPECULAR_INTENSITYMAP" : "", n.roughnessMap ? "#define USE_ROUGHNESSMAP" : "", n.metalnessMap ? "#define USE_METALNESSMAP" : "", n.alphaMap ? "#define USE_ALPHAMAP" : "", n.alphaHash ? "#define USE_ALPHAHASH" : "", n.transmission ? "#define USE_TRANSMISSION" : "", n.transmissionMap ? "#define USE_TRANSMISSIONMAP" : "", n.thicknessMap ? "#define USE_THICKNESSMAP" : "", n.sheenColorMap ? "#define USE_SHEEN_COLORMAP" : "", n.sheenRoughnessMap ? "#define USE_SHEEN_ROUGHNESSMAP" : "", n.mapUv ? "#define MAP_UV " + n.mapUv : "", n.alphaMapUv ? "#define ALPHAMAP_UV " + n.alphaMapUv : "", n.lightMapUv ? "#define LIGHTMAP_UV " + n.lightMapUv : "", n.aoMapUv ? "#define AOMAP_UV " + n.aoMapUv : "", n.emissiveMapUv ? "#define EMISSIVEMAP_UV " + n.emissiveMapUv : "", n.bumpMapUv ? "#define BUMPMAP_UV " + n.bumpMapUv : "", n.normalMapUv ? "#define NORMALMAP_UV " + n.normalMapUv : "", n.displacementMapUv ? "#define DISPLACEMENTMAP_UV " + n.displacementMapUv : "", n.metalnessMapUv ? "#define METALNESSMAP_UV " + n.metalnessMapUv : "", n.roughnessMapUv ? "#define ROUGHNESSMAP_UV " + n.roughnessMapUv : "", n.anisotropyMapUv ? "#define ANISOTROPYMAP_UV " + n.anisotropyMapUv : "", n.clearcoatMapUv ? "#define CLEARCOATMAP_UV " + n.clearcoatMapUv : "", n.clearcoatNormalMapUv ? "#define CLEARCOAT_NORMALMAP_UV " + n.clearcoatNormalMapUv : "", n.clearcoatRoughnessMapUv ? "#define CLEARCOAT_ROUGHNESSMAP_UV " + n.clearcoatRoughnessMapUv : "", n.iridescenceMapUv ? "#define IRIDESCENCEMAP_UV " + n.iridescenceMapUv : "", n.iridescenceThicknessMapUv ? "#define IRIDESCENCE_THICKNESSMAP_UV " + n.iridescenceThicknessMapUv : "", n.sheenColorMapUv ? "#define SHEEN_COLORMAP_UV " + n.sheenColorMapUv : "", n.sheenRoughnessMapUv ? "#define SHEEN_ROUGHNESSMAP_UV " + n.sheenRoughnessMapUv : "", n.specularMapUv ? "#define SPECULARMAP_UV " + n.specularMapUv : "", n.specularColorMapUv ? "#define SPECULAR_COLORMAP_UV " + n.specularColorMapUv : "", n.specularIntensityMapUv ? "#define SPECULAR_INTENSITYMAP_UV " + n.specularIntensityMapUv : "", n.transmissionMapUv ? "#define TRANSMISSIONMAP_UV " + n.transmissionMapUv : "", n.thicknessMapUv ? "#define THICKNESSMAP_UV " + n.thicknessMapUv : "", n.vertexTangents && !1 === n.flatShading ? "#define USE_TANGENT" : "", n.vertexColors ? "#define USE_COLOR" : "", n.vertexAlphas ? "#define USE_COLOR_ALPHA" : "", n.vertexUv1s ? "#define USE_UV1" : "", n.vertexUv2s ? "#define USE_UV2" : "", n.vertexUv3s ? "#define USE_UV3" : "", n.pointsUvs ? "#define USE_POINTS_UV" : "", n.flatShading ? "#define FLAT_SHADED" : "", n.skinning ? "#define USE_SKINNING" : "", n.morphTargets ? "#define USE_MORPHTARGETS" : "", n.morphNormals && !1 === n.flatShading ? "#define USE_MORPHNORMALS" : "", n.morphColors ? "#define USE_MORPHCOLORS" : "", n.morphTargetsCount > 0 ? "#define MORPHTARGETS_TEXTURE_STRIDE " + n.morphTextureStride : "", n.morphTargetsCount > 0 ? "#define MORPHTARGETS_COUNT " + n.morphTargetsCount : "", n.doubleSided ? "#define DOUBLE_SIDED" : "", n.flipSided ? "#define FLIP_SIDED" : "", n.shadowMapEnabled ? "#define USE_SHADOWMAP" : "", n.shadowMapEnabled ? "#define " + l : "", n.sizeAttenuation ? "#define USE_SIZEATTENUATION" : "", n.numLightProbes > 0 ? "#define USE_LIGHT_PROBES" : "", n.logarithmicDepthBuffer ? "#define USE_LOGARITHMIC_DEPTH_BUFFER" : "", n.reversedDepthBuffer ? "#define USE_REVERSED_DEPTH_BUFFER" : "", "uniform mat4 modelMatrix;", "uniform mat4 modelViewMatrix;", "uniform mat4 projectionMatrix;", "uniform mat4 viewMatrix;", "uniform mat3 normalMatrix;", "uniform vec3 cameraPosition;", "uniform bool isOrthographic;", "#ifdef USE_INSTANCING", "\tattribute mat4 instanceMatrix;", "#endif", "#ifdef USE_INSTANCING_COLOR", "\tattribute vec3 instanceColor;", "#endif", "#ifdef USE_INSTANCING_MORPH", "\tuniform sampler2D morphTexture;", "#endif", "attribute vec3 position;", "attribute vec3 normal;", "attribute vec2 uv;", "#ifdef USE_UV1", "\tattribute vec2 uv1;", "#endif", "#ifdef USE_UV2", "\tattribute vec2 uv2;", "#endif", "#ifdef USE_UV3", "\tattribute vec2 uv3;", "#endif", "#ifdef USE_TANGENT", "\tattribute vec4 tangent;", "#endif", "#if defined( USE_COLOR_ALPHA )", "\tattribute vec4 color;", "#elif defined( USE_COLOR )", "\tattribute vec3 color;", "#endif", "#ifdef USE_SKINNING", "\tattribute vec4 skinIndex;", "\tattribute vec4 skinWeight;", "#endif", "\n"].filter(hs).join("\n"), _ = [Ms(n), "#define SHADER_TYPE " + n.shaderType, "#define SHADER_NAME " + n.shaderName, m, n.useFog && n.fog ? "#define USE_FOG" : "", n.useFog && n.fogExp2 ? "#define FOG_EXP2" : "", n.alphaToCoverage ? "#define ALPHA_TO_COVERAGE" : "", n.map ? "#define USE_MAP" : "", n.matcap ? "#define USE_MATCAP" : "", n.envMap ? "#define USE_ENVMAP" : "", n.envMap ? "#define " + c : "", n.envMap ? "#define " + h : "", n.envMap ? "#define " + u : "", d ? "#define CUBEUV_TEXEL_WIDTH " + d.texelWidth : "", d ? "#define CUBEUV_TEXEL_HEIGHT " + d.texelHeight : "", d ? "#define CUBEUV_MAX_MIP " + d.maxMip + ".0" : "", n.lightMap ? "#define USE_LIGHTMAP" : "", n.aoMap ? "#define USE_AOMAP" : "", n.bumpMap ? "#define USE_BUMPMAP" : "", n.normalMap ? "#define USE_NORMALMAP" : "", n.normalMapObjectSpace ? "#define USE_NORMALMAP_OBJECTSPACE" : "", n.normalMapTangentSpace ? "#define USE_NORMALMAP_TANGENTSPACE" : "", n.emissiveMap ? "#define USE_EMISSIVEMAP" : "", n.anisotropy ? "#define USE_ANISOTROPY" : "", n.anisotropyMap ? "#define USE_ANISOTROPYMAP" : "", n.clearcoat ? "#define USE_CLEARCOAT" : "", n.clearcoatMap ? "#define USE_CLEARCOATMAP" : "", n.clearcoatRoughnessMap ? "#define USE_CLEARCOAT_ROUGHNESSMAP" : "", n.clearcoatNormalMap ? "#define USE_CLEARCOAT_NORMALMAP" : "", n.dispersion ? "#define USE_DISPERSION" : "", n.iridescence ? "#define USE_IRIDESCENCE" : "", n.iridescenceMap ? "#define USE_IRIDESCENCEMAP" : "", n.iridescenceThicknessMap ? "#define USE_IRIDESCENCE_THICKNESSMAP" : "", n.specularMap ? "#define USE_SPECULARMAP" : "", n.specularColorMap ? "#define USE_SPECULAR_COLORMAP" : "", n.specularIntensityMap ? "#define USE_SPECULAR_INTENSITYMAP" : "", n.roughnessMap ? "#define USE_ROUGHNESSMAP" : "", n.metalnessMap ? "#define USE_METALNESSMAP" : "", n.alphaMap ? "#define USE_ALPHAMAP" : "", n.alphaTest ? "#define USE_ALPHATEST" : "", n.alphaHash ? "#define USE_ALPHAHASH" : "", n.sheen ? "#define USE_SHEEN" : "", n.sheenColorMap ? "#define USE_SHEEN_COLORMAP" : "", n.sheenRoughnessMap ? "#define USE_SHEEN_ROUGHNESSMAP" : "", n.transmission ? "#define USE_TRANSMISSION" : "", n.transmissionMap ? "#define USE_TRANSMISSIONMAP" : "", n.thicknessMap ? "#define USE_THICKNESSMAP" : "", n.vertexTangents && !1 === n.flatShading ? "#define USE_TANGENT" : "", n.vertexColors || n.instancingColor ? "#define USE_COLOR" : "", n.vertexAlphas || n.batchingColor ? "#define USE_COLOR_ALPHA" : "", n.vertexUv1s ? "#define USE_UV1" : "", n.vertexUv2s ? "#define USE_UV2" : "", n.vertexUv3s ? "#define USE_UV3" : "", n.pointsUvs ? "#define USE_POINTS_UV" : "", n.gradientMap ? "#define USE_GRADIENTMAP" : "", n.flatShading ? "#define FLAT_SHADED" : "", n.doubleSided ? "#define DOUBLE_SIDED" : "", n.flipSided ? "#define FLIP_SIDED" : "", n.shadowMapEnabled ? "#define USE_SHADOWMAP" : "", n.shadowMapEnabled ? "#define " + l : "", n.premultipliedAlpha ? "#define PREMULTIPLIED_ALPHA" : "", n.numLightProbes > 0 ? "#define USE_LIGHT_PROBES" : "", n.decodeVideoTexture ? "#define DECODE_VIDEO_TEXTURE" : "", n.decodeVideoTextureEmissive ? "#define DECODE_VIDEO_TEXTURE_EMISSIVE" : "", n.logarithmicDepthBuffer ? "#define USE_LOGARITHMIC_DEPTH_BUFFER" : "", n.reversedDepthBuffer ? "#define USE_REVERSED_DEPTH_BUFFER" : "", "uniform mat4 viewMatrix;", "uniform vec3 cameraPosition;", "uniform bool isOrthographic;", 0 !== n.toneMapping ? "#define TONE_MAPPING" : "", 0 !== n.toneMapping ? fa.tonemapping_pars_fragment : "", 0 !== n.toneMapping ? ls("toneMapping", n.toneMapping) : "", n.dithering ? "#define DITHERING" : "", n.opaque ? "#define OPAQUE" : "", fa.colorspace_pars_fragment, ss("linearToOutputTexel", n.outputColorSpace), (mt.getLuminanceCoefficients(cs), ["float luminance( const in vec3 rgb ) {", `\tconst vec3 weights = vec3( ${cs.x.toFixed(4)}, ${cs.y.toFixed(4)}, ${cs.z.toFixed(4)} );`, "\treturn dot( weights, rgb );", "}"].join("\n")), n.useDepthPacking ? "#define DEPTH_PACKING " + n.depthPacking : "", "\n"].filter(hs).join("\n")), s = ms(s), s = us(s, n), s = ds(s, n), o = ms(o), o = us(o, n), o = ds(o, n), s = vs(s), o = vs(o), !0 !== n.isRawShaderMaterial && (v = "#version 300 es\n", g = [p, "#define attribute in", "#define varying out", "#define texture2D texture"].join("\n") + "\n" + g, _ = ["#define varying in", "300 es" === n.glslVersion ? "" : "layout(location = 0) out highp vec4 pc_fragColor;", "300 es" === n.glslVersion ? "" : "#define gl_FragColor pc_fragColor", "#define gl_FragDepthEXT gl_FragDepth", "#define texture2D texture", "#define textureCube texture", "#define texture2DProj textureProj", "#define texture2DLodEXT textureLod", "#define texture2DProjLodEXT textureProjLod", "#define textureCubeLodEXT textureLod", "#define texture2DGradEXT textureGrad", "#define texture2DProjGradEXT textureProjGrad", "#define textureCubeGradEXT textureGrad"].join("\n") + "\n" + _);
    const x = v + g + s,
        M = v + _ + o,
        b = ns(a, a.VERTEX_SHADER, x),
        y = ns(a, a.FRAGMENT_SHADER, M);

    function S(e) {
        if (t.debug.checkShaderErrors) {
            const n = a.getProgramInfoLog(f) || "",
                i = a.getShaderInfoLog(b) || "",
                r = a.getShaderInfoLog(y) || "",
                s = n.trim(),
                o = i.trim(),
                l = r.trim();
            let c = !0,
                h = !0;
            if (!1 === a.getProgramParameter(f, a.LINK_STATUS))
                if (c = !1, "function" == typeof t.debug.onShaderError) t.debug.onShaderError(a, f, b, y);
                else {
                    const t = rs(a, b, "vertex"),
                        n = rs(a, y, "fragment");
                    H("THREE.WebGLProgram: Shader Error " + a.getError() + " - VALIDATE_STATUS " + a.getProgramParameter(f, a.VALIDATE_STATUS) + "\n\nMaterial Name: " + e.name + "\nMaterial Type: " + e.type + "\n\nProgram Info Log: " + s + "\n" + t + "\n" + n)
                }
            else "" !== s ? k("WebGLProgram: Program Info Log:", s) : "" !== o && "" !== l || (h = !1);
            h && (e.diagnostics = {
                runnable: c,
                programLog: s,
                vertexShader: {
                    log: o,
                    prefix: g
                },
                fragmentShader: {
                    log: l,
                    prefix: _
                }
            })
        }
        a.deleteShader(b), a.deleteShader(y), E = new es(a, f), T = function(t, e) {
            const n = {},
                i = t.getProgramParameter(e, t.ACTIVE_ATTRIBUTES);
            for (let a = 0; a < i; a++) {
                const i = t.getActiveAttrib(e, a),
                    r = i.name;
                let s = 1;
                i.type === t.FLOAT_MAT2 && (s = 2), i.type === t.FLOAT_MAT3 && (s = 3), i.type === t.FLOAT_MAT4 && (s = 4), n[r] = {
                    type: i.type,
                    location: t.getAttribLocation(e, r),
                    locationSize: s
                }
            }
            return n
        }(a, f)
    }
    let E, T;
    a.attachShader(f, b), a.attachShader(f, y), void 0 !== n.index0AttributeName ? a.bindAttribLocation(f, 0, n.index0AttributeName) : !0 === n.morphTargets && a.bindAttribLocation(f, 0, "position"), a.linkProgram(f), this.getUniforms = function() {
        return void 0 === E && S(this), E
    }, this.getAttributes = function() {
        return void 0 === T && S(this), T
    };
    let w = !1 === n.rendererExtensionParallelShaderCompile;
    return this.isReady = function() {
        return !1 === w && (w = a.getProgramParameter(f, 37297)), w
    }, this.destroy = function() {
        i.releaseStatesOfProgram(this), a.deleteProgram(f), this.program = void 0
    }, this.type = n.shaderType, this.name = n.shaderName, this.id = is++, this.cacheKey = e, this.usedTimes = 1, this.program = f, this.vertexShader = b, this.fragmentShader = y, this
}
var ws = 0,
    As = class {
        constructor() {
            this.shaderCache = new Map, this.materialCache = new Map
        }
        update(t) {
            const e = t.vertexShader,
                n = t.fragmentShader,
                i = this._getShaderStage(e),
                a = this._getShaderStage(n),
                r = this._getShaderCacheForMaterial(t);
            return !1 === r.has(i) && (r.add(i), i.usedTimes++), !1 === r.has(a) && (r.add(a), a.usedTimes++), this
        }
        remove(t) {
            const e = this.materialCache.get(t);
            for (const n of e) n.usedTimes--, 0 === n.usedTimes && this.shaderCache.delete(n.code);
            return this.materialCache.delete(t), this
        }
        getVertexShaderID(t) {
            return this._getShaderStage(t.vertexShader).id
        }
        getFragmentShaderID(t) {
            return this._getShaderStage(t.fragmentShader).id
        }
        dispose() {
            this.shaderCache.clear(), this.materialCache.clear()
        }
        _getShaderCacheForMaterial(t) {
            const e = this.materialCache;
            let n = e.get(t);
            return void 0 === n && (n = new Set, e.set(t, n)), n
        }
        _getShaderStage(t) {
            const e = this.shaderCache;
            let n = e.get(t);
            return void 0 === n && (n = new Rs(t), e.set(t, n)), n
        }
    },
    Rs = class {
        constructor(t) {
            this.id = ws++, this.code = t, this.usedTimes = 0
        }
    };

function Cs(t, e, n, i, a, r) {
    const s = new Vt,
        o = new As,
        l = new Set,
        c = [],
        h = new Map,
        u = i.logarithmicDepthBuffer;
    let d = i.precision;
    const p = {
        MeshDepthMaterial: "depth",
        MeshDistanceMaterial: "distance",
        MeshNormalMaterial: "normal",
        MeshBasicMaterial: "basic",
        MeshLambertMaterial: "lambert",
        MeshPhongMaterial: "phong",
        MeshToonMaterial: "toon",
        MeshStandardMaterial: "physical",
        MeshPhysicalMaterial: "physical",
        MeshMatcapMaterial: "matcap",
        LineBasicMaterial: "basic",
        LineDashedMaterial: "dashed",
        PointsMaterial: "points",
        ShadowMaterial: "shadow",
        SpriteMaterial: "sprite"
    };

    function m(t) {
        return l.add(t), 0 === t ? "uv" : `uv${t}`
    }
    return {
        getParameters: function(a, s, c, h, f) {
            const g = h.fog,
                _ = f.geometry,
                v = a.isMeshStandardMaterial || a.isMeshLambertMaterial || a.isMeshPhongMaterial ? h.environment : null,
                x = a.isMeshStandardMaterial || a.isMeshLambertMaterial && !a.envMap || a.isMeshPhongMaterial && !a.envMap,
                M = e.get(a.envMap || v, x),
                b = M && 306 === M.mapping ? M.image.height : null,
                y = p[a.type];
            null !== a.precision && (d = i.getMaxPrecision(a.precision), d !== a.precision && k("WebGLProgram.getParameters:", a.precision, "not supported, using", d, "instead."));
            const S = _.morphAttributes.position || _.morphAttributes.normal || _.morphAttributes.color,
                E = void 0 !== S ? S.length : 0;
            let T, w, A, R, C = 0;
            if (void 0 !== _.morphAttributes.position && (C = 1), void 0 !== _.morphAttributes.normal && (C = 2), void 0 !== _.morphAttributes.color && (C = 3), y) {
                const t = _a[y];
                T = t.vertexShader, w = t.fragmentShader
            } else T = a.vertexShader, w = a.fragmentShader, o.update(a), A = o.getVertexShaderID(a), R = o.getFragmentShaderID(a);
            const P = t.getRenderTarget(),
                L = t.state.buffers.depth.getReversed(),
                I = !0 === f.isInstancedMesh,
                U = !0 === f.isBatchedMesh,
                N = !!a.map,
                O = !!a.matcap,
                F = !!M,
                B = !!a.aoMap,
                z = !!a.lightMap,
                V = !!a.bumpMap,
                H = !!a.normalMap,
                G = !!a.displacementMap,
                W = !!a.emissiveMap,
                X = !!a.metalnessMap,
                Y = !!a.roughnessMap,
                j = a.anisotropy > 0,
                q = a.clearcoat > 0,
                Z = a.dispersion > 0,
                K = a.iridescence > 0,
                J = a.sheen > 0,
                $ = a.transmission > 0,
                Q = j && !!a.anisotropyMap,
                tt = q && !!a.clearcoatMap,
                et = q && !!a.clearcoatNormalMap,
                nt = q && !!a.clearcoatRoughnessMap,
                it = K && !!a.iridescenceMap,
                at = K && !!a.iridescenceThicknessMap,
                rt = J && !!a.sheenColorMap,
                st = J && !!a.sheenRoughnessMap,
                ot = !!a.specularMap,
                lt = !!a.specularColorMap,
                ct = !!a.specularIntensityMap,
                ht = $ && !!a.transmissionMap,
                ut = $ && !!a.thicknessMap,
                dt = !!a.gradientMap,
                pt = !!a.alphaMap,
                ft = a.alphaTest > 0,
                gt = !!a.alphaHash,
                _t = !!a.extensions;
            let vt = 0;
            a.toneMapped && (null !== P && !0 !== P.isXRRenderTarget || (vt = t.toneMapping));
            const xt = {
                shaderID: y,
                shaderType: a.type,
                shaderName: a.name,
                vertexShader: T,
                fragmentShader: w,
                defines: a.defines,
                customVertexShaderID: A,
                customFragmentShaderID: R,
                isRawShaderMaterial: !0 === a.isRawShaderMaterial,
                glslVersion: a.glslVersion,
                precision: d,
                batching: U,
                batchingColor: U && null !== f._colorsTexture,
                instancing: I,
                instancingColor: I && null !== f.instanceColor,
                instancingMorph: I && null !== f.morphTexture,
                outputColorSpace: null === P ? t.outputColorSpace : !0 === P.isXRRenderTarget ? P.texture.colorSpace : D,
                alphaToCoverage: !!a.alphaToCoverage,
                map: N,
                matcap: O,
                envMap: F,
                envMapMode: F && M.mapping,
                envMapCubeUVHeight: b,
                aoMap: B,
                lightMap: z,
                bumpMap: V,
                normalMap: H,
                displacementMap: G,
                emissiveMap: W,
                normalMapObjectSpace: H && 1 === a.normalMapType,
                normalMapTangentSpace: H && 0 === a.normalMapType,
                metalnessMap: X,
                roughnessMap: Y,
                anisotropy: j,
                anisotropyMap: Q,
                clearcoat: q,
                clearcoatMap: tt,
                clearcoatNormalMap: et,
                clearcoatRoughnessMap: nt,
                dispersion: Z,
                iridescence: K,
                iridescenceMap: it,
                iridescenceThicknessMap: at,
                sheen: J,
                sheenColorMap: rt,
                sheenRoughnessMap: st,
                specularMap: ot,
                specularColorMap: lt,
                specularIntensityMap: ct,
                transmission: $,
                transmissionMap: ht,
                thicknessMap: ut,
                gradientMap: dt,
                opaque: !1 === a.transparent && 1 === a.blending && !1 === a.alphaToCoverage,
                alphaMap: pt,
                alphaTest: ft,
                alphaHash: gt,
                combine: a.combine,
                mapUv: N && m(a.map.channel),
                aoMapUv: B && m(a.aoMap.channel),
                lightMapUv: z && m(a.lightMap.channel),
                bumpMapUv: V && m(a.bumpMap.channel),
                normalMapUv: H && m(a.normalMap.channel),
                displacementMapUv: G && m(a.displacementMap.channel),
                emissiveMapUv: W && m(a.emissiveMap.channel),
                metalnessMapUv: X && m(a.metalnessMap.channel),
                roughnessMapUv: Y && m(a.roughnessMap.channel),
                anisotropyMapUv: Q && m(a.anisotropyMap.channel),
                clearcoatMapUv: tt && m(a.clearcoatMap.channel),
                clearcoatNormalMapUv: et && m(a.clearcoatNormalMap.channel),
                clearcoatRoughnessMapUv: nt && m(a.clearcoatRoughnessMap.channel),
                iridescenceMapUv: it && m(a.iridescenceMap.channel),
                iridescenceThicknessMapUv: at && m(a.iridescenceThicknessMap.channel),
                sheenColorMapUv: rt && m(a.sheenColorMap.channel),
                sheenRoughnessMapUv: st && m(a.sheenRoughnessMap.channel),
                specularMapUv: ot && m(a.specularMap.channel),
                specularColorMapUv: lt && m(a.specularColorMap.channel),
                specularIntensityMapUv: ct && m(a.specularIntensityMap.channel),
                transmissionMapUv: ht && m(a.transmissionMap.channel),
                thicknessMapUv: ut && m(a.thicknessMap.channel),
                alphaMapUv: pt && m(a.alphaMap.channel),
                vertexTangents: !!_.attributes.tangent && (H || j),
                vertexColors: a.vertexColors,
                vertexAlphas: !0 === a.vertexColors && !!_.attributes.color && 4 === _.attributes.color.itemSize,
                pointsUvs: !0 === f.isPoints && !!_.attributes.uv && (N || pt),
                fog: !!g,
                useFog: !0 === a.fog,
                fogExp2: !!g && g.isFogExp2,
                flatShading: !1 === a.wireframe && (!0 === a.flatShading || void 0 === _.attributes.normal && !1 === H && (a.isMeshLambertMaterial || a.isMeshPhongMaterial || a.isMeshStandardMaterial || a.isMeshPhysicalMaterial)),
                sizeAttenuation: !0 === a.sizeAttenuation,
                logarithmicDepthBuffer: u,
                reversedDepthBuffer: L,
                skinning: !0 === f.isSkinnedMesh,
                morphTargets: void 0 !== _.morphAttributes.position,
                morphNormals: void 0 !== _.morphAttributes.normal,
                morphColors: void 0 !== _.morphAttributes.color,
                morphTargetsCount: E,
                morphTextureStride: C,
                numDirLights: s.directional.length,
                numPointLights: s.point.length,
                numSpotLights: s.spot.length,
                numSpotLightMaps: s.spotLightMap.length,
                numRectAreaLights: s.rectArea.length,
                numHemiLights: s.hemi.length,
                numDirLightShadows: s.directionalShadowMap.length,
                numPointLightShadows: s.pointShadowMap.length,
                numSpotLightShadows: s.spotShadowMap.length,
                numSpotLightShadowsWithMaps: s.numSpotLightShadowsWithMaps,
                numLightProbes: s.numLightProbes,
                numClippingPlanes: r.numPlanes,
                numClipIntersection: r.numIntersection,
                dithering: a.dithering,
                shadowMapEnabled: t.shadowMap.enabled && c.length > 0,
                shadowMapType: t.shadowMap.type,
                toneMapping: vt,
                decodeVideoTexture: N && !0 === a.map.isVideoTexture && "srgb" === mt.getTransfer(a.map.colorSpace),
                decodeVideoTextureEmissive: W && !0 === a.emissiveMap.isVideoTexture && "srgb" === mt.getTransfer(a.emissiveMap.colorSpace),
                premultipliedAlpha: a.premultipliedAlpha,
                doubleSided: 2 === a.side,
                flipSided: 1 === a.side,
                useDepthPacking: a.depthPacking >= 0,
                depthPacking: a.depthPacking || 0,
                index0AttributeName: a.index0AttributeName,
                extensionClipCullDistance: _t && !0 === a.extensions.clipCullDistance && n.has("WEBGL_clip_cull_distance"),
                extensionMultiDraw: (_t && !0 === a.extensions.multiDraw || U) && n.has("WEBGL_multi_draw"),
                rendererExtensionParallelShaderCompile: n.has("KHR_parallel_shader_compile"),
                customProgramCacheKey: a.customProgramCacheKey()
            };
            return xt.vertexUv1s = l.has(1), xt.vertexUv2s = l.has(2), xt.vertexUv3s = l.has(3), l.clear(), xt
        },
        getProgramCacheKey: function(e) {
            const n = [];
            if (e.shaderID ? n.push(e.shaderID) : (n.push(e.customVertexShaderID), n.push(e.customFragmentShaderID)), void 0 !== e.defines)
                for (const t in e.defines) n.push(t), n.push(e.defines[t]);
            return !1 === e.isRawShaderMaterial && (! function(t, e) {
                t.push(e.precision), t.push(e.outputColorSpace), t.push(e.envMapMode), t.push(e.envMapCubeUVHeight), t.push(e.mapUv), t.push(e.alphaMapUv), t.push(e.lightMapUv), t.push(e.aoMapUv), t.push(e.bumpMapUv), t.push(e.normalMapUv), t.push(e.displacementMapUv), t.push(e.emissiveMapUv), t.push(e.metalnessMapUv), t.push(e.roughnessMapUv), t.push(e.anisotropyMapUv), t.push(e.clearcoatMapUv), t.push(e.clearcoatNormalMapUv), t.push(e.clearcoatRoughnessMapUv), t.push(e.iridescenceMapUv), t.push(e.iridescenceThicknessMapUv), t.push(e.sheenColorMapUv), t.push(e.sheenRoughnessMapUv), t.push(e.specularMapUv), t.push(e.specularColorMapUv), t.push(e.specularIntensityMapUv), t.push(e.transmissionMapUv), t.push(e.thicknessMapUv), t.push(e.combine), t.push(e.fogExp2), t.push(e.sizeAttenuation), t.push(e.morphTargetsCount), t.push(e.morphAttributeCount), t.push(e.numDirLights), t.push(e.numPointLights), t.push(e.numSpotLights), t.push(e.numSpotLightMaps), t.push(e.numHemiLights), t.push(e.numRectAreaLights), t.push(e.numDirLightShadows), t.push(e.numPointLightShadows), t.push(e.numSpotLightShadows), t.push(e.numSpotLightShadowsWithMaps), t.push(e.numLightProbes), t.push(e.shadowMapType), t.push(e.toneMapping), t.push(e.numClippingPlanes), t.push(e.numClipIntersection), t.push(e.depthPacking)
            }(n, e), function(t, e) {
                s.disableAll(), e.instancing && s.enable(0);
                e.instancingColor && s.enable(1);
                e.instancingMorph && s.enable(2);
                e.matcap && s.enable(3);
                e.envMap && s.enable(4);
                e.normalMapObjectSpace && s.enable(5);
                e.normalMapTangentSpace && s.enable(6);
                e.clearcoat && s.enable(7);
                e.iridescence && s.enable(8);
                e.alphaTest && s.enable(9);
                e.vertexColors && s.enable(10);
                e.vertexAlphas && s.enable(11);
                e.vertexUv1s && s.enable(12);
                e.vertexUv2s && s.enable(13);
                e.vertexUv3s && s.enable(14);
                e.vertexTangents && s.enable(15);
                e.anisotropy && s.enable(16);
                e.alphaHash && s.enable(17);
                e.batching && s.enable(18);
                e.dispersion && s.enable(19);
                e.batchingColor && s.enable(20);
                e.gradientMap && s.enable(21);
                t.push(s.mask), s.disableAll(), e.fog && s.enable(0);
                e.useFog && s.enable(1);
                e.flatShading && s.enable(2);
                e.logarithmicDepthBuffer && s.enable(3);
                e.reversedDepthBuffer && s.enable(4);
                e.skinning && s.enable(5);
                e.morphTargets && s.enable(6);
                e.morphNormals && s.enable(7);
                e.morphColors && s.enable(8);
                e.premultipliedAlpha && s.enable(9);
                e.shadowMapEnabled && s.enable(10);
                e.doubleSided && s.enable(11);
                e.flipSided && s.enable(12);
                e.useDepthPacking && s.enable(13);
                e.dithering && s.enable(14);
                e.transmission && s.enable(15);
                e.sheen && s.enable(16);
                e.opaque && s.enable(17);
                e.pointsUvs && s.enable(18);
                e.decodeVideoTexture && s.enable(19);
                e.decodeVideoTextureEmissive && s.enable(20);
                e.alphaToCoverage && s.enable(21);
                t.push(s.mask)
            }(n, e), n.push(t.outputColorSpace)), n.push(e.customProgramCacheKey), n.join()
        },
        getUniforms: function(t) {
            const e = p[t.type];
            let n;
            if (e) {
                const t = _a[e];
                n = gi.clone(t.uniforms)
            } else n = t.uniforms;
            return n
        },
        acquireProgram: function(e, n) {
            let i = h.get(n);
            return void 0 !== i ? ++i.usedTimes : (i = new Ts(t, n, e, a), c.push(i), h.set(n, i)), i
        },
        releaseProgram: function(t) {
            if (0 === --t.usedTimes) {
                const e = c.indexOf(t);
                c[e] = c[c.length - 1], c.pop(), h.delete(t.cacheKey), t.destroy()
            }
        },
        releaseShaderCache: function(t) {
            o.remove(t)
        },
        programs: c,
        dispose: function() {
            o.dispose()
        }
    }
}

function Ps() {
    let t = new WeakMap;
    return {
        has: function(e) {
            return t.has(e)
        },
        get: function(e) {
            let n = t.get(e);
            return void 0 === n && (n = {}, t.set(e, n)), n
        },
        remove: function(e) {
            t.delete(e)
        },
        update: function(e, n, i) {
            t.get(e)[n] = i
        },
        dispose: function() {
            t = new WeakMap
        }
    }
}

function Ds(t, e) {
    return t.groupOrder !== e.groupOrder ? t.groupOrder - e.groupOrder : t.renderOrder !== e.renderOrder ? t.renderOrder - e.renderOrder : t.material.id !== e.material.id ? t.material.id - e.material.id : t.materialVariant !== e.materialVariant ? t.materialVariant - e.materialVariant : t.z !== e.z ? t.z - e.z : t.id - e.id
}

function Ls(t, e) {
    return t.groupOrder !== e.groupOrder ? t.groupOrder - e.groupOrder : t.renderOrder !== e.renderOrder ? t.renderOrder - e.renderOrder : t.z !== e.z ? e.z - t.z : t.id - e.id
}

function Is() {
    const t = [];
    let e = 0;
    const n = [],
        i = [],
        a = [];

    function r(t) {
        let e = 0;
        return t.isInstancedMesh && (e += 2), t.isSkinnedMesh && (e += 1), e
    }

    function s(n, i, a, s, o, l) {
        let c = t[e];
        return void 0 === c ? (c = {
            id: n.id,
            object: n,
            geometry: i,
            material: a,
            materialVariant: r(n),
            groupOrder: s,
            renderOrder: n.renderOrder,
            z: o,
            group: l
        }, t[e] = c) : (c.id = n.id, c.object = n, c.geometry = i, c.material = a, c.materialVariant = r(n), c.groupOrder = s, c.renderOrder = n.renderOrder, c.z = o, c.group = l), e++, c
    }
    return {
        opaque: n,
        transmissive: i,
        transparent: a,
        init: function() {
            e = 0, n.length = 0, i.length = 0, a.length = 0
        },
        push: function(t, e, r, o, l, c) {
            const h = s(t, e, r, o, l, c);
            r.transmission > 0 ? i.push(h) : !0 === r.transparent ? a.push(h) : n.push(h)
        },
        unshift: function(t, e, r, o, l, c) {
            const h = s(t, e, r, o, l, c);
            r.transmission > 0 ? i.unshift(h) : !0 === r.transparent ? a.unshift(h) : n.unshift(h)
        },
        finish: function() {
            for (let n = e, i = t.length; n < i; n++) {
                const e = t[n];
                if (null === e.id) break;
                e.id = null, e.object = null, e.geometry = null, e.material = null, e.group = null
            }
        },
        sort: function(t, e) {
            n.length > 1 && n.sort(t || Ds), i.length > 1 && i.sort(e || Ls), a.length > 1 && a.sort(e || Ls)
        }
    }
}

function Us() {
    let t = new WeakMap;
    return {
        get: function(e, n) {
            const i = t.get(e);
            let a;
            return void 0 === i ? (a = new Is, t.set(e, [a])) : n >= i.length ? (a = new Is, i.push(a)) : a = i[n], a
        },
        dispose: function() {
            t = new WeakMap
        }
    }
}

function Ns() {
    const t = {};
    return {
        get: function(e) {
            if (void 0 !== t[e.id]) return t[e.id];
            let n;
            switch (e.type) {
                case "DirectionalLight":
                    n = {
                        direction: new rt,
                        color: new he
                    };
                    break;
                case "SpotLight":
                    n = {
                        position: new rt,
                        direction: new rt,
                        color: new he,
                        distance: 0,
                        coneCos: 0,
                        penumbraCos: 0,
                        decay: 0
                    };
                    break;
                case "PointLight":
                    n = {
                        position: new rt,
                        color: new he,
                        distance: 0,
                        decay: 0
                    };
                    break;
                case "HemisphereLight":
                    n = {
                        direction: new rt,
                        skyColor: new he,
                        groundColor: new he
                    };
                    break;
                case "RectAreaLight":
                    n = {
                        color: new he,
                        position: new rt,
                        halfWidth: new rt,
                        halfHeight: new rt
                    }
            }
            return t[e.id] = n, n
        }
    }
}
var Os = 0;

function Fs(t, e) {
    return (e.castShadow ? 2 : 0) - (t.castShadow ? 2 : 0) + (e.map ? 1 : 0) - (t.map ? 1 : 0)
}

function Bs(t) {
    const e = new Ns,
        n = function() {
            const t = {};
            return {
                get: function(e) {
                    if (void 0 !== t[e.id]) return t[e.id];
                    let n;
                    switch (e.type) {
                        case "DirectionalLight":
                        case "SpotLight":
                            n = {
                                shadowIntensity: 1,
                                shadowBias: 0,
                                shadowNormalBias: 0,
                                shadowRadius: 1,
                                shadowMapSize: new it
                            };
                            break;
                        case "PointLight":
                            n = {
                                shadowIntensity: 1,
                                shadowBias: 0,
                                shadowNormalBias: 0,
                                shadowRadius: 1,
                                shadowMapSize: new it,
                                shadowCameraNear: 1,
                                shadowCameraFar: 1e3
                            }
                    }
                    return t[e.id] = n, n
                }
            }
        }(),
        i = {
            version: 0,
            hash: {
                directionalLength: -1,
                pointLength: -1,
                spotLength: -1,
                rectAreaLength: -1,
                hemiLength: -1,
                numDirectionalShadows: -1,
                numPointShadows: -1,
                numSpotShadows: -1,
                numSpotMaps: -1,
                numLightProbes: -1
            },
            ambient: [0, 0, 0],
            probe: [],
            directional: [],
            directionalShadow: [],
            directionalShadowMap: [],
            directionalShadowMatrix: [],
            spot: [],
            spotLightMap: [],
            spotShadow: [],
            spotShadowMap: [],
            spotLightMatrix: [],
            rectArea: [],
            rectAreaLTC1: null,
            rectAreaLTC2: null,
            point: [],
            pointShadow: [],
            pointShadowMap: [],
            pointShadowMatrix: [],
            hemi: [],
            numSpotLightShadowsWithMaps: 0,
            numLightProbes: 0
        };
    for (let o = 0; o < 9; o++) i.probe.push(new rt);
    const a = new rt,
        r = new Ct,
        s = new Ct;
    return {
        setup: function(a) {
            let r = 0,
                s = 0,
                o = 0;
            for (let t = 0; t < 9; t++) i.probe[t].set(0, 0, 0);
            let l = 0,
                c = 0,
                h = 0,
                u = 0,
                d = 0,
                p = 0,
                m = 0,
                f = 0,
                g = 0,
                _ = 0,
                v = 0;
            a.sort(Fs);
            for (let t = 0, M = a.length; t < M; t++) {
                const x = a[t],
                    M = x.color,
                    b = x.intensity,
                    y = x.distance;
                let S = null;
                if (x.shadow && x.shadow.map && (S = 1030 === x.shadow.map.texture.format ? x.shadow.map.texture : x.shadow.map.depthTexture || x.shadow.map.texture), x.isAmbientLight) r += M.r * b, s += M.g * b, o += M.b * b;
                else if (x.isLightProbe) {
                    for (let t = 0; t < 9; t++) i.probe[t].addScaledVector(x.sh.coefficients[t], b);
                    v++
                } else if (x.isDirectionalLight) {
                    const t = e.get(x);
                    if (t.color.copy(x.color).multiplyScalar(x.intensity), x.castShadow) {
                        const t = x.shadow,
                            e = n.get(x);
                        e.shadowIntensity = t.intensity, e.shadowBias = t.bias, e.shadowNormalBias = t.normalBias, e.shadowRadius = t.radius, e.shadowMapSize = t.mapSize, i.directionalShadow[l] = e, i.directionalShadowMap[l] = S, i.directionalShadowMatrix[l] = x.shadow.matrix, p++
                    }
                    i.directional[l] = t, l++
                } else if (x.isSpotLight) {
                    const t = e.get(x);
                    t.position.setFromMatrixPosition(x.matrixWorld), t.color.copy(M).multiplyScalar(b), t.distance = y, t.coneCos = Math.cos(x.angle), t.penumbraCos = Math.cos(x.angle * (1 - x.penumbra)), t.decay = x.decay, i.spot[h] = t;
                    const a = x.shadow;
                    if (x.map && (i.spotLightMap[g] = x.map, g++, a.updateMatrices(x), x.castShadow && _++), i.spotLightMatrix[h] = a.matrix, x.castShadow) {
                        const t = n.get(x);
                        t.shadowIntensity = a.intensity, t.shadowBias = a.bias, t.shadowNormalBias = a.normalBias, t.shadowRadius = a.radius, t.shadowMapSize = a.mapSize, i.spotShadow[h] = t, i.spotShadowMap[h] = S, f++
                    }
                    h++
                } else if (x.isRectAreaLight) {
                    const t = e.get(x);
                    t.color.copy(M).multiplyScalar(b), t.halfWidth.set(.5 * x.width, 0, 0), t.halfHeight.set(0, .5 * x.height, 0), i.rectArea[u] = t, u++
                } else if (x.isPointLight) {
                    const t = e.get(x);
                    if (t.color.copy(x.color).multiplyScalar(x.intensity), t.distance = x.distance, t.decay = x.decay, x.castShadow) {
                        const t = x.shadow,
                            e = n.get(x);
                        e.shadowIntensity = t.intensity, e.shadowBias = t.bias, e.shadowNormalBias = t.normalBias, e.shadowRadius = t.radius, e.shadowMapSize = t.mapSize, e.shadowCameraNear = t.camera.near, e.shadowCameraFar = t.camera.far, i.pointShadow[c] = e, i.pointShadowMap[c] = S, i.pointShadowMatrix[c] = x.shadow.matrix, m++
                    }
                    i.point[c] = t, c++
                } else if (x.isHemisphereLight) {
                    const t = e.get(x);
                    t.skyColor.copy(x.color).multiplyScalar(b), t.groundColor.copy(x.groundColor).multiplyScalar(b), i.hemi[d] = t, d++
                }
            }
            u > 0 && (!0 === t.has("OES_texture_float_linear") ? (i.rectAreaLTC1 = ga.LTC_FLOAT_1, i.rectAreaLTC2 = ga.LTC_FLOAT_2) : (i.rectAreaLTC1 = ga.LTC_HALF_1, i.rectAreaLTC2 = ga.LTC_HALF_2)), i.ambient[0] = r, i.ambient[1] = s, i.ambient[2] = o;
            const x = i.hash;
            x.directionalLength === l && x.pointLength === c && x.spotLength === h && x.rectAreaLength === u && x.hemiLength === d && x.numDirectionalShadows === p && x.numPointShadows === m && x.numSpotShadows === f && x.numSpotMaps === g && x.numLightProbes === v || (i.directional.length = l, i.spot.length = h, i.rectArea.length = u, i.point.length = c, i.hemi.length = d, i.directionalShadow.length = p, i.directionalShadowMap.length = p, i.pointShadow.length = m, i.pointShadowMap.length = m, i.spotShadow.length = f, i.spotShadowMap.length = f, i.directionalShadowMatrix.length = p, i.pointShadowMatrix.length = m, i.spotLightMatrix.length = f + g - _, i.spotLightMap.length = g, i.numSpotLightShadowsWithMaps = _, i.numLightProbes = v, x.directionalLength = l, x.pointLength = c, x.spotLength = h, x.rectAreaLength = u, x.hemiLength = d, x.numDirectionalShadows = p, x.numPointShadows = m, x.numSpotShadows = f, x.numSpotMaps = g, x.numLightProbes = v, i.version = Os++)
        },
        setupView: function(t, e) {
            let n = 0,
                o = 0,
                l = 0,
                c = 0,
                h = 0;
            const u = e.matrixWorldInverse;
            for (let d = 0, p = t.length; d < p; d++) {
                const e = t[d];
                if (e.isDirectionalLight) {
                    const t = i.directional[n];
                    t.direction.setFromMatrixPosition(e.matrixWorld), a.setFromMatrixPosition(e.target.matrixWorld), t.direction.sub(a), t.direction.transformDirection(u), n++
                } else if (e.isSpotLight) {
                    const t = i.spot[l];
                    t.position.setFromMatrixPosition(e.matrixWorld), t.position.applyMatrix4(u), t.direction.setFromMatrixPosition(e.matrixWorld), a.setFromMatrixPosition(e.target.matrixWorld), t.direction.sub(a), t.direction.transformDirection(u), l++
                } else if (e.isRectAreaLight) {
                    const t = i.rectArea[c];
                    t.position.setFromMatrixPosition(e.matrixWorld), t.position.applyMatrix4(u), s.identity(), r.copy(e.matrixWorld), r.premultiply(u), s.extractRotation(r), t.halfWidth.set(.5 * e.width, 0, 0), t.halfHeight.set(0, .5 * e.height, 0), t.halfWidth.applyMatrix4(s), t.halfHeight.applyMatrix4(s), c++
                } else if (e.isPointLight) {
                    const t = i.point[o];
                    t.position.setFromMatrixPosition(e.matrixWorld), t.position.applyMatrix4(u), o++
                } else if (e.isHemisphereLight) {
                    const t = i.hemi[h];
                    t.direction.setFromMatrixPosition(e.matrixWorld), t.direction.transformDirection(u), h++
                }
            }
        },
        state: i
    }
}

function zs(t) {
    const e = new Bs(t),
        n = [],
        i = [];
    const a = {
        lightsArray: n,
        shadowsArray: i,
        camera: null,
        lights: e,
        transmissionRenderTarget: {}
    };
    return {
        init: function(t) {
            a.camera = t, n.length = 0, i.length = 0
        },
        state: a,
        setupLights: function() {
            e.setup(n)
        },
        setupLightsView: function(t) {
            e.setupView(n, t)
        },
        pushLight: function(t) {
            n.push(t)
        },
        pushShadow: function(t) {
            i.push(t)
        }
    }
}

function Vs(t) {
    let e = new WeakMap;
    return {
        get: function(n, i = 0) {
            const a = e.get(n);
            let r;
            return void 0 === a ? (r = new zs(t), e.set(n, [r])) : i >= a.length ? (r = new zs(t), a.push(r)) : r = a[i], r
        },
        dispose: function() {
            e = new WeakMap
        }
    }
}
var ks = [new rt(1, 0, 0), new rt(-1, 0, 0), new rt(0, 1, 0), new rt(0, -1, 0), new rt(0, 0, 1), new rt(0, 0, -1)],
    Hs = [new rt(0, -1, 0), new rt(0, -1, 0), new rt(0, 0, 1), new rt(0, 0, -1), new rt(0, -1, 0), new rt(0, -1, 0)],
    Gs = new Ct,
    Ws = new rt,
    Xs = new rt;

function Ys(t, e, n) {
    let i = new ri;
    const a = new it,
        r = new it,
        s = new Et,
        o = new Mi,
        l = new bi,
        c = {},
        h = n.maxTextureSize,
        d = {
            0: 1,
            1: 0,
            2: 2
        },
        p = new _i({
            defines: {
                VSM_SAMPLES: 8
            },
            uniforms: {
                shadow_pass: {
                    value: null
                },
                resolution: {
                    value: new it
                },
                radius: {
                    value: 4
                }
            },
            vertexShader: "void main() {\n\tgl_Position = vec4( position, 1.0 );\n}",
            fragmentShader: "uniform sampler2D shadow_pass;\nuniform vec2 resolution;\nuniform float radius;\nvoid main() {\n\tconst float samples = float( VSM_SAMPLES );\n\tfloat mean = 0.0;\n\tfloat squared_mean = 0.0;\n\tfloat uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );\n\tfloat uvStart = samples <= 1.0 ? 0.0 : - 1.0;\n\tfor ( float i = 0.0; i < samples; i ++ ) {\n\t\tfloat uvOffset = uvStart + i * uvStride;\n\t\t#ifdef HORIZONTAL_PASS\n\t\t\tvec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;\n\t\t\tmean += distribution.x;\n\t\t\tsquared_mean += distribution.y * distribution.y + distribution.x * distribution.x;\n\t\t#else\n\t\t\tfloat depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;\n\t\t\tmean += depth;\n\t\t\tsquared_mean += depth * depth;\n\t\t#endif\n\t}\n\tmean = mean / samples;\n\tsquared_mean = squared_mean / samples;\n\tfloat std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );\n\tgl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );\n}"
        }),
        f = p.clone();
    f.defines.HORIZONTAL_PASS = 1;
    const g = new ln;
    g.setAttribute("position", new Ye(new Float32Array([-1, -1, .5, 3, -1, .5, -1, 3, .5]), 3));
    const _ = new Zn(g, p),
        v = this;
    this.enabled = !1, this.autoUpdate = !0, this.needsUpdate = !1, this.type = 1;
    let y = this.type;

    function S(n, i) {
        const r = e.update(_);
        p.defines.VSM_SAMPLES !== n.blurSamples && (p.defines.VSM_SAMPLES = n.blurSamples, f.defines.VSM_SAMPLES = n.blurSamples, p.needsUpdate = !0, f.needsUpdate = !0), null === n.mapPass && (n.mapPass = new wt(a.x, a.y, {
            format: w,
            type: b
        })), p.uniforms.shadow_pass.value = n.map.depthTexture, p.uniforms.resolution.value = n.mapSize, p.uniforms.radius.value = n.radius, t.setRenderTarget(n.mapPass), t.clear(), t.renderBufferDirect(i, null, r, p, _, null), f.uniforms.shadow_pass.value = n.mapPass.texture, f.uniforms.resolution.value = n.mapSize, f.uniforms.radius.value = n.radius, t.setRenderTarget(n.map), t.clear(), t.renderBufferDirect(i, null, r, f, _, null)
    }

    function E(e, n, i, a) {
        let r = null;
        const s = !0 === i.isPointLight ? e.customDistanceMaterial : e.customDepthMaterial;
        if (void 0 !== s) r = s;
        else if (r = !0 === i.isPointLight ? l : o, t.localClippingEnabled && !0 === n.clipShadows && Array.isArray(n.clippingPlanes) && 0 !== n.clippingPlanes.length || n.displacementMap && 0 !== n.displacementScale || n.alphaMap && n.alphaTest > 0 || n.map && n.alphaTest > 0 || !0 === n.alphaToCoverage) {
            const t = r.uuid,
                e = n.uuid;
            let i = c[t];
            void 0 === i && (i = {}, c[t] = i);
            let a = i[e];
            void 0 === a && (a = r.clone(), i[e] = a, n.addEventListener("dispose", R)), r = a
        }
        if (r.visible = n.visible, r.wireframe = n.wireframe, r.side = 3 === a ? null !== n.shadowSide ? n.shadowSide : n.side : null !== n.shadowSide ? n.shadowSide : d[n.side], r.alphaMap = n.alphaMap, r.alphaTest = !0 === n.alphaToCoverage ? .5 : n.alphaTest, r.map = n.map, r.clipShadows = n.clipShadows, r.clippingPlanes = n.clippingPlanes, r.clipIntersection = n.clipIntersection, r.displacementMap = n.displacementMap, r.displacementScale = n.displacementScale, r.displacementBias = n.displacementBias, r.wireframeLinewidth = n.wireframeLinewidth, r.linewidth = n.linewidth, !0 === i.isPointLight && !0 === r.isMeshDistanceMaterial) {
            t.properties.get(r).light = i
        }
        return r
    }

    function A(n, a, r, s, o) {
        if (!1 === n.visible) return;
        if (n.layers.test(a.layers) && (n.isMesh || n.isLine || n.isPoints) && (n.castShadow || n.receiveShadow && 3 === o) && (!n.frustumCulled || i.intersectsObject(n))) {
            n.modelViewMatrix.multiplyMatrices(r.matrixWorldInverse, n.matrixWorld);
            const i = e.update(n),
                l = n.material;
            if (Array.isArray(l)) {
                const e = i.groups;
                for (let c = 0, h = e.length; c < h; c++) {
                    const h = e[c],
                        u = l[h.materialIndex];
                    if (u && u.visible) {
                        const e = E(n, u, s, o);
                        n.onBeforeShadow(t, n, a, r, i, e, h), t.renderBufferDirect(r, null, i, e, n, h), n.onAfterShadow(t, n, a, r, i, e, h)
                    }
                }
            } else if (l.visible) {
                const e = E(n, l, s, o);
                n.onBeforeShadow(t, n, a, r, i, e, null), t.renderBufferDirect(r, null, i, e, n, null), n.onAfterShadow(t, n, a, r, i, e, null)
            }
        }
        const l = n.children;
        for (let t = 0, e = l.length; t < e; t++) A(l[t], a, r, s, o)
    }

    function R(t) {
        t.target.removeEventListener("dispose", R);
        for (const e in c) {
            const n = c[e],
                i = t.target.uuid;
            i in n && (n[i].dispose(), delete n[i])
        }
    }
    this.render = function(e, n, o) {
        if (!1 === v.enabled) return;
        if (!1 === v.autoUpdate && !1 === v.needsUpdate) return;
        if (0 === e.length) return;
        2 === this.type && (k("WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead."), this.type = 1);
        const l = t.getRenderTarget(),
            c = t.getActiveCubeFace(),
            d = t.getActiveMipmapLevel(),
            p = t.state;
        p.setBlending(0), !0 === p.buffers.depth.getReversed() ? p.buffers.color.setClear(0, 0, 0, 0) : p.buffers.color.setClear(1, 1, 1, 1), p.buffers.depth.setTest(!0), p.setScissorTest(!1);
        const f = y !== this.type;
        f && n.traverse(function(t) {
            t.material && (Array.isArray(t.material) ? t.material.forEach(t => t.needsUpdate = !0) : t.material.needsUpdate = !0)
        });
        for (let g = 0, _ = e.length; g < _; g++) {
            const l = e[g],
                c = l.shadow;
            if (void 0 === c) {
                k("WebGLShadowMap:", l, "has no shadow.");
                continue
            }
            if (!1 === c.autoUpdate && !1 === c.needsUpdate) continue;
            a.copy(c.mapSize);
            const d = c.getFrameExtents();
            a.multiply(d), r.copy(c.mapSize), (a.x > h || a.y > h) && (a.x > h && (r.x = Math.floor(h / d.x), a.x = r.x * d.x, c.mapSize.x = r.x), a.y > h && (r.y = Math.floor(h / d.y), a.y = r.y * d.y, c.mapSize.y = r.y));
            const _ = t.state.buffers.depth.getReversed();
            if (c.camera._reversedDepth = _, null === c.map || !0 === f) {
                if (null !== c.map && (null !== c.map.depthTexture && (c.map.depthTexture.dispose(), c.map.depthTexture = null), c.map.dispose()), 3 === this.type) {
                    if (l.isPointLight) {
                        k("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");
                        continue
                    }
                    c.map = new wt(a.x, a.y, {
                        format: w,
                        type: b,
                        minFilter: m,
                        magFilter: m,
                        generateMipmaps: !1
                    }), c.map.texture.name = l.name + ".shadowMap", c.map.depthTexture = new li(a.x, a.y, M), c.map.depthTexture.name = l.name + ".shadowMapDepth", c.map.depthTexture.format = T, c.map.depthTexture.compareFunction = null, c.map.depthTexture.minFilter = u, c.map.depthTexture.magFilter = u
                } else l.isPointLight ? (c.map = new ka(a.x), c.map.depthTexture = new ci(a.x, x)) : (c.map = new wt(a.x, a.y), c.map.depthTexture = new li(a.x, a.y, x)), c.map.depthTexture.name = l.name + ".shadowMap", c.map.depthTexture.format = T, 1 === this.type ? (c.map.depthTexture.compareFunction = _ ? 518 : 515, c.map.depthTexture.minFilter = m, c.map.depthTexture.magFilter = m) : (c.map.depthTexture.compareFunction = null, c.map.depthTexture.minFilter = u, c.map.depthTexture.magFilter = u);
                c.camera.updateProjectionMatrix()
            }
            const v = c.map.isWebGLCubeRenderTarget ? 6 : 1;
            for (let e = 0; e < v; e++) {
                if (c.map.isWebGLCubeRenderTarget) t.setRenderTarget(c.map, e), t.clear();
                else {
                    0 === e && (t.setRenderTarget(c.map), t.clear());
                    const n = c.getViewport(e);
                    s.set(r.x * n.x, r.y * n.y, r.x * n.z, r.y * n.w), p.viewport(s)
                }
                if (l.isPointLight) {
                    const t = c.camera,
                        n = c.matrix,
                        i = l.distance || t.far;
                    i !== t.far && (t.far = i, t.updateProjectionMatrix()), Ws.setFromMatrixPosition(l.matrixWorld), t.position.copy(Ws), Xs.copy(t.position), Xs.add(ks[e]), t.up.copy(Hs[e]), t.lookAt(Xs), t.updateMatrixWorld(), n.makeTranslation(-Ws.x, -Ws.y, -Ws.z), Gs.multiplyMatrices(t.projectionMatrix, t.matrixWorldInverse), c._frustum.setFromProjectionMatrix(Gs, t.coordinateSystem, t.reversedDepth)
                } else c.updateMatrices(l);
                i = c.getFrustum(), A(n, o, c.camera, l, this.type)
            }!0 !== c.isPointLightShadow && 3 === this.type && S(c, o), c.needsUpdate = !1
        }
        y = this.type, v.needsUpdate = !1, t.setRenderTarget(l, c, d)
    }
}

function js(t, e) {
    const n = new function() {
            let e = !1;
            const n = new Et;
            let i = null;
            const a = new Et(0, 0, 0, 0);
            return {
                setMask: function(n) {
                    i === n || e || (t.colorMask(n, n, n, n), i = n)
                },
                setLocked: function(t) {
                    e = t
                },
                setClear: function(e, i, r, s, o) {
                    !0 === o && (e *= s, i *= s, r *= s), n.set(e, i, r, s), !1 === a.equals(n) && (t.clearColor(e, i, r, s), a.copy(n))
                },
                reset: function() {
                    e = !1, i = null, a.set(-1, 0, 0, 0)
                }
            }
        },
        i = new function() {
            let n = !1,
                i = !1,
                a = null,
                r = null,
                s = null;
            return {
                setReversed: function(t) {
                    if (i !== t) {
                        const n = e.get("EXT_clip_control");
                        t ? n.clipControlEXT(n.LOWER_LEFT_EXT, n.ZERO_TO_ONE_EXT) : n.clipControlEXT(n.LOWER_LEFT_EXT, n.NEGATIVE_ONE_TO_ONE_EXT), i = t;
                        const a = s;
                        s = null, this.setClear(a)
                    }
                },
                getReversed: function() {
                    return i
                },
                setTest: function(e) {
                    e ? V(t.DEPTH_TEST) : k(t.DEPTH_TEST)
                },
                setMask: function(e) {
                    a === e || n || (t.depthMask(e), a = e)
                },
                setFunc: function(e) {
                    if (i && (e = W[e]), r !== e) {
                        switch (e) {
                            case 0:
                                t.depthFunc(t.NEVER);
                                break;
                            case 1:
                                t.depthFunc(t.ALWAYS);
                                break;
                            case 2:
                                t.depthFunc(t.LESS);
                                break;
                            case 3:
                            default:
                                t.depthFunc(t.LEQUAL);
                                break;
                            case 4:
                                t.depthFunc(t.EQUAL);
                                break;
                            case 5:
                                t.depthFunc(t.GEQUAL);
                                break;
                            case 6:
                                t.depthFunc(t.GREATER);
                                break;
                            case 7:
                                t.depthFunc(t.NOTEQUAL)
                        }
                        r = e
                    }
                },
                setLocked: function(t) {
                    n = t
                },
                setClear: function(e) {
                    s !== e && (s = e, i && (e = 1 - e), t.clearDepth(e))
                },
                reset: function() {
                    n = !1, a = null, r = null, s = null, i = !1
                }
            }
        },
        a = new function() {
            let e = !1,
                n = null,
                i = null,
                a = null,
                r = null,
                s = null,
                o = null,
                l = null,
                c = null;
            return {
                setTest: function(n) {
                    e || (n ? V(t.STENCIL_TEST) : k(t.STENCIL_TEST))
                },
                setMask: function(i) {
                    n === i || e || (t.stencilMask(i), n = i)
                },
                setFunc: function(e, n, s) {
                    i === e && a === n && r === s || (t.stencilFunc(e, n, s), i = e, a = n, r = s)
                },
                setOp: function(e, n, i) {
                    s === e && o === n && l === i || (t.stencilOp(e, n, i), s = e, o = n, l = i)
                },
                setLocked: function(t) {
                    e = t
                },
                setClear: function(e) {
                    c !== e && (t.clearStencil(e), c = e)
                },
                reset: function() {
                    e = !1, n = null, i = null, a = null, r = null, s = null, o = null, l = null, c = null
                }
            }
        },
        r = new WeakMap,
        s = new WeakMap;
    let o = {},
        l = {},
        c = new WeakMap,
        h = [],
        u = null,
        d = !1,
        p = null,
        m = null,
        f = null,
        g = null,
        _ = null,
        v = null,
        x = null,
        M = new he(0, 0, 0),
        b = 0,
        y = !1,
        S = null,
        E = null,
        T = null,
        w = null,
        A = null;
    const R = t.getParameter(t.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
    let C = !1,
        P = 0;
    const D = t.getParameter(t.VERSION); - 1 !== D.indexOf("WebGL") ? (P = parseFloat(/^WebGL (\d)/.exec(D)[1]), C = P >= 1) : -1 !== D.indexOf("OpenGL ES") && (P = parseFloat(/^OpenGL ES (\d)/.exec(D)[1]), C = P >= 2);
    let L = null,
        I = {};
    const U = t.getParameter(t.SCISSOR_BOX),
        N = t.getParameter(t.VIEWPORT),
        O = (new Et).fromArray(U),
        F = (new Et).fromArray(N);

    function B(e, n, i, a) {
        const r = new Uint8Array(4),
            s = t.createTexture();
        t.bindTexture(e, s), t.texParameteri(e, t.TEXTURE_MIN_FILTER, t.NEAREST), t.texParameteri(e, t.TEXTURE_MAG_FILTER, t.NEAREST);
        for (let o = 0; o < i; o++) e === t.TEXTURE_3D || e === t.TEXTURE_2D_ARRAY ? t.texImage3D(n, 0, t.RGBA, 1, 1, a, 0, t.RGBA, t.UNSIGNED_BYTE, r) : t.texImage2D(n + o, 0, t.RGBA, 1, 1, 0, t.RGBA, t.UNSIGNED_BYTE, r);
        return s
    }
    const z = {};

    function V(e) {
        !0 !== o[e] && (t.enable(e), o[e] = !0)
    }

    function k(e) {
        !1 !== o[e] && (t.disable(e), o[e] = !1)
    }
    z[t.TEXTURE_2D] = B(t.TEXTURE_2D, t.TEXTURE_2D, 1), z[t.TEXTURE_CUBE_MAP] = B(t.TEXTURE_CUBE_MAP, t.TEXTURE_CUBE_MAP_POSITIVE_X, 6), z[t.TEXTURE_2D_ARRAY] = B(t.TEXTURE_2D_ARRAY, t.TEXTURE_2D_ARRAY, 1, 1), z[t.TEXTURE_3D] = B(t.TEXTURE_3D, t.TEXTURE_3D, 1, 1), n.setClear(0, 0, 0, 1), i.setClear(1), a.setClear(0), V(t.DEPTH_TEST), i.setFunc(3), j(!1), q(1), V(t.CULL_FACE), Y(0);
    const G = {
        100: t.FUNC_ADD,
        101: t.FUNC_SUBTRACT,
        102: t.FUNC_REVERSE_SUBTRACT
    };
    G[103] = t.MIN, G[104] = t.MAX;
    const X = {
        200: t.ZERO,
        201: t.ONE,
        202: t.SRC_COLOR,
        204: t.SRC_ALPHA,
        210: t.SRC_ALPHA_SATURATE,
        208: t.DST_COLOR,
        206: t.DST_ALPHA,
        203: t.ONE_MINUS_SRC_COLOR,
        205: t.ONE_MINUS_SRC_ALPHA,
        209: t.ONE_MINUS_DST_COLOR,
        207: t.ONE_MINUS_DST_ALPHA,
        211: t.CONSTANT_COLOR,
        212: t.ONE_MINUS_CONSTANT_COLOR,
        213: t.CONSTANT_ALPHA,
        214: t.ONE_MINUS_CONSTANT_ALPHA
    };

    function Y(e, n, i, a, r, s, o, l, c, h) {
        if (0 !== e) {
            if (!1 === d && (V(t.BLEND), d = !0), 5 === e) r = r || n, s = s || i, o = o || a, n === m && r === _ || (t.blendEquationSeparate(G[n], G[r]), m = n, _ = r), i === f && a === g && s === v && o === x || (t.blendFuncSeparate(X[i], X[a], X[s], X[o]), f = i, g = a, v = s, x = o), !1 !== l.equals(M) && c === b || (t.blendColor(l.r, l.g, l.b, c), M.copy(l), b = c), p = e, y = !1;
            else if (e !== p || h !== y) {
                if (100 === m && 100 === _ || (t.blendEquation(t.FUNC_ADD), m = 100, _ = 100), h) switch (e) {
                    case 1:
                        t.blendFuncSeparate(t.ONE, t.ONE_MINUS_SRC_ALPHA, t.ONE, t.ONE_MINUS_SRC_ALPHA);
                        break;
                    case 2:
                        t.blendFunc(t.ONE, t.ONE);
                        break;
                    case 3:
                        t.blendFuncSeparate(t.ZERO, t.ONE_MINUS_SRC_COLOR, t.ZERO, t.ONE);
                        break;
                    case 4:
                        t.blendFuncSeparate(t.DST_COLOR, t.ONE_MINUS_SRC_ALPHA, t.ZERO, t.ONE);
                        break;
                    default:
                        H("WebGLState: Invalid blending: ", e)
                } else switch (e) {
                    case 1:
                        t.blendFuncSeparate(t.SRC_ALPHA, t.ONE_MINUS_SRC_ALPHA, t.ONE, t.ONE_MINUS_SRC_ALPHA);
                        break;
                    case 2:
                        t.blendFuncSeparate(t.SRC_ALPHA, t.ONE, t.ONE, t.ONE);
                        break;
                    case 3:
                        H("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");
                        break;
                    case 4:
                        H("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");
                        break;
                    default:
                        H("WebGLState: Invalid blending: ", e)
                }
                f = null, g = null, v = null, x = null, M.set(0, 0, 0), b = 0, p = e, y = h
            }
        } else !0 === d && (k(t.BLEND), d = !1)
    }

    function j(e) {
        S !== e && (e ? t.frontFace(t.CW) : t.frontFace(t.CCW), S = e)
    }

    function q(e) {
        0 !== e ? (V(t.CULL_FACE), e !== E && (1 === e ? t.cullFace(t.BACK) : 2 === e ? t.cullFace(t.FRONT) : t.cullFace(t.FRONT_AND_BACK))) : k(t.CULL_FACE), E = e
    }

    function Z(e, n, a) {
        e ? (V(t.POLYGON_OFFSET_FILL), w === n && A === a || (w = n, A = a, i.getReversed() && (n = -n), t.polygonOffset(n, a))) : k(t.POLYGON_OFFSET_FILL)
    }
    return {
        buffers: {
            color: n,
            depth: i,
            stencil: a
        },
        enable: V,
        disable: k,
        bindFramebuffer: function(e, n) {
            return l[e] !== n && (t.bindFramebuffer(e, n), l[e] = n, e === t.DRAW_FRAMEBUFFER && (l[t.FRAMEBUFFER] = n), e === t.FRAMEBUFFER && (l[t.DRAW_FRAMEBUFFER] = n), !0)
        },
        drawBuffers: function(e, n) {
            let i = h,
                a = !1;
            if (e) {
                i = c.get(n), void 0 === i && (i = [], c.set(n, i));
                const r = e.textures;
                if (i.length !== r.length || i[0] !== t.COLOR_ATTACHMENT0) {
                    for (let e = 0, n = r.length; e < n; e++) i[e] = t.COLOR_ATTACHMENT0 + e;
                    i.length = r.length, a = !0
                }
            } else i[0] !== t.BACK && (i[0] = t.BACK, a = !0);
            a && t.drawBuffers(i)
        },
        useProgram: function(e) {
            return u !== e && (t.useProgram(e), u = e, !0)
        },
        setBlending: Y,
        setMaterial: function(e, r) {
            2 === e.side ? k(t.CULL_FACE) : V(t.CULL_FACE);
            let s = 1 === e.side;
            r && (s = !s), j(s), 1 === e.blending && !1 === e.transparent ? Y(0) : Y(e.blending, e.blendEquation, e.blendSrc, e.blendDst, e.blendEquationAlpha, e.blendSrcAlpha, e.blendDstAlpha, e.blendColor, e.blendAlpha, e.premultipliedAlpha), i.setFunc(e.depthFunc), i.setTest(e.depthTest), i.setMask(e.depthWrite), n.setMask(e.colorWrite);
            const o = e.stencilWrite;
            a.setTest(o), o && (a.setMask(e.stencilWriteMask), a.setFunc(e.stencilFunc, e.stencilRef, e.stencilFuncMask), a.setOp(e.stencilFail, e.stencilZFail, e.stencilZPass)), Z(e.polygonOffset, e.polygonOffsetFactor, e.polygonOffsetUnits), !0 === e.alphaToCoverage ? V(t.SAMPLE_ALPHA_TO_COVERAGE) : k(t.SAMPLE_ALPHA_TO_COVERAGE)
        },
        setFlipSided: j,
        setCullFace: q,
        setLineWidth: function(e) {
            e !== T && (C && t.lineWidth(e), T = e)
        },
        setPolygonOffset: Z,
        setScissorTest: function(e) {
            e ? V(t.SCISSOR_TEST) : k(t.SCISSOR_TEST)
        },
        activeTexture: function(e) {
            void 0 === e && (e = t.TEXTURE0 + R - 1), L !== e && (t.activeTexture(e), L = e)
        },
        bindTexture: function(e, n, i) {
            void 0 === i && (i = null === L ? t.TEXTURE0 + R - 1 : L);
            let a = I[i];
            void 0 === a && (a = {
                type: void 0,
                texture: void 0
            }, I[i] = a), a.type === e && a.texture === n || (L !== i && (t.activeTexture(i), L = i), t.bindTexture(e, n || z[e]), a.type = e, a.texture = n)
        },
        unbindTexture: function() {
            const e = I[L];
            void 0 !== e && void 0 !== e.type && (t.bindTexture(e.type, null), e.type = void 0, e.texture = void 0)
        },
        compressedTexImage2D: function() {
            try {
                t.compressedTexImage2D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        compressedTexImage3D: function() {
            try {
                t.compressedTexImage3D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        texImage2D: function() {
            try {
                t.texImage2D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        texImage3D: function() {
            try {
                t.texImage3D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        updateUBOMapping: function(e, n) {
            let i = s.get(n);
            void 0 === i && (i = new WeakMap, s.set(n, i));
            let a = i.get(e);
            void 0 === a && (a = t.getUniformBlockIndex(n, e.name), i.set(e, a))
        },
        uniformBlockBinding: function(e, n) {
            const i = s.get(n).get(e);
            r.get(n) !== i && (t.uniformBlockBinding(n, i, e.__bindingPointIndex), r.set(n, i))
        },
        texStorage2D: function() {
            try {
                t.texStorage2D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        texStorage3D: function() {
            try {
                t.texStorage3D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        texSubImage2D: function() {
            try {
                t.texSubImage2D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        texSubImage3D: function() {
            try {
                t.texSubImage3D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        compressedTexSubImage2D: function() {
            try {
                t.compressedTexSubImage2D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        compressedTexSubImage3D: function() {
            try {
                t.compressedTexSubImage3D(...arguments)
            } catch (e) {
                H("WebGLState:", e)
            }
        },
        scissor: function(e) {
            !1 === O.equals(e) && (t.scissor(e.x, e.y, e.z, e.w), O.copy(e))
        },
        viewport: function(e) {
            !1 === F.equals(e) && (t.viewport(e.x, e.y, e.z, e.w), F.copy(e))
        },
        reset: function() {
            t.disable(t.BLEND), t.disable(t.CULL_FACE), t.disable(t.DEPTH_TEST), t.disable(t.POLYGON_OFFSET_FILL), t.disable(t.SCISSOR_TEST), t.disable(t.STENCIL_TEST), t.disable(t.SAMPLE_ALPHA_TO_COVERAGE), t.blendEquation(t.FUNC_ADD), t.blendFunc(t.ONE, t.ZERO), t.blendFuncSeparate(t.ONE, t.ZERO, t.ONE, t.ZERO), t.blendColor(0, 0, 0, 0), t.colorMask(!0, !0, !0, !0), t.clearColor(0, 0, 0, 0), t.depthMask(!0), t.depthFunc(t.LESS), i.setReversed(!1), t.clearDepth(1), t.stencilMask(4294967295), t.stencilFunc(t.ALWAYS, 0, 4294967295), t.stencilOp(t.KEEP, t.KEEP, t.KEEP), t.clearStencil(0), t.cullFace(t.BACK), t.frontFace(t.CCW), t.polygonOffset(0, 0), t.activeTexture(t.TEXTURE0), t.bindFramebuffer(t.FRAMEBUFFER, null), t.bindFramebuffer(t.DRAW_FRAMEBUFFER, null), t.bindFramebuffer(t.READ_FRAMEBUFFER, null), t.useProgram(null), t.lineWidth(1), t.scissor(0, 0, t.canvas.width, t.canvas.height), t.viewport(0, 0, t.canvas.width, t.canvas.height), o = {}, L = null, I = {}, l = {}, c = new WeakMap, h = [], u = null, d = !1, p = null, m = null, f = null, g = null, _ = null, v = null, x = null, M = new he(0, 0, 0), b = 0, y = !1, S = null, E = null, T = null, w = null, A = null, O.set(0, 0, t.canvas.width, t.canvas.height), F.set(0, 0, t.canvas.width, t.canvas.height), n.reset(), i.reset(), a.reset()
        }
    }
}

function qs(t, e, n, i, a, r, s) {
    const o = e.has("WEBGL_multisampled_render_to_texture") ? e.get("WEBGL_multisampled_render_to_texture") : null,
        _ = "undefined" != typeof navigator && /OculusBrowser/g.test(navigator.userAgent),
        v = new it,
        x = new WeakMap;
    let M;
    const b = new WeakMap;
    let y = !1;
    try {
        y = "undefined" != typeof OffscreenCanvas && null !== new OffscreenCanvas(1, 1).getContext("2d")
    } catch (at) {}

    function S(t, e) {
        return y ? new OffscreenCanvas(t, e) : O("canvas")
    }

    function E(t, e, n) {
        let i = 1;
        const a = nt(t);
        if ((a.width > n || a.height > n) && (i = n / Math.max(a.width, a.height)), i < 1) {
            if ("undefined" != typeof HTMLImageElement && t instanceof HTMLImageElement || "undefined" != typeof HTMLCanvasElement && t instanceof HTMLCanvasElement || "undefined" != typeof ImageBitmap && t instanceof ImageBitmap || "undefined" != typeof VideoFrame && t instanceof VideoFrame) {
                const n = Math.floor(i * a.width),
                    r = Math.floor(i * a.height);
                void 0 === M && (M = S(n, r));
                const s = e ? S(n, r) : M;
                return s.width = n, s.height = r, s.getContext("2d").drawImage(t, 0, 0, n, r), k("WebGLRenderer: Texture has been resized from (" + a.width + "x" + a.height + ") to (" + n + "x" + r + ")."), s
            }
            return "data" in t && k("WebGLRenderer: Image in DataTexture is too big (" + a.width + "x" + a.height + ")."), t
        }
        return t
    }

    function T(t) {
        return t.generateMipmaps
    }

    function w(e) {
        t.generateMipmap(e)
    }

    function A(e) {
        return e.isWebGLCubeRenderTarget ? t.TEXTURE_CUBE_MAP : e.isWebGL3DRenderTarget ? t.TEXTURE_3D : e.isWebGLArrayRenderTarget || e.isCompressedArrayTexture ? t.TEXTURE_2D_ARRAY : t.TEXTURE_2D
    }

    function R(n, i, a, r, s = !1) {
        if (null !== n) {
            if (void 0 !== t[n]) return t[n];
            k("WebGLRenderer: Attempt to use non-existing WebGL internal format '" + n + "'")
        }
        let o = i;
        if (i === t.RED && (a === t.FLOAT && (o = t.R32F), a === t.HALF_FLOAT && (o = t.R16F), a === t.UNSIGNED_BYTE && (o = t.R8)), i === t.RED_INTEGER && (a === t.UNSIGNED_BYTE && (o = t.R8UI), a === t.UNSIGNED_SHORT && (o = t.R16UI), a === t.UNSIGNED_INT && (o = t.R32UI), a === t.BYTE && (o = t.R8I), a === t.SHORT && (o = t.R16I), a === t.INT && (o = t.R32I)), i === t.RG && (a === t.FLOAT && (o = t.RG32F), a === t.HALF_FLOAT && (o = t.RG16F), a === t.UNSIGNED_BYTE && (o = t.RG8)), i === t.RG_INTEGER && (a === t.UNSIGNED_BYTE && (o = t.RG8UI), a === t.UNSIGNED_SHORT && (o = t.RG16UI), a === t.UNSIGNED_INT && (o = t.RG32UI), a === t.BYTE && (o = t.RG8I), a === t.SHORT && (o = t.RG16I), a === t.INT && (o = t.RG32I)), i === t.RGB_INTEGER && (a === t.UNSIGNED_BYTE && (o = t.RGB8UI), a === t.UNSIGNED_SHORT && (o = t.RGB16UI), a === t.UNSIGNED_INT && (o = t.RGB32UI), a === t.BYTE && (o = t.RGB8I), a === t.SHORT && (o = t.RGB16I), a === t.INT && (o = t.RGB32I)), i === t.RGBA_INTEGER && (a === t.UNSIGNED_BYTE && (o = t.RGBA8UI), a === t.UNSIGNED_SHORT && (o = t.RGBA16UI), a === t.UNSIGNED_INT && (o = t.RGBA32UI), a === t.BYTE && (o = t.RGBA8I), a === t.SHORT && (o = t.RGBA16I), a === t.INT && (o = t.RGBA32I)), i === t.RGB && (a === t.UNSIGNED_INT_5_9_9_9_REV && (o = t.RGB9_E5), a === t.UNSIGNED_INT_10F_11F_11F_REV && (o = t.R11F_G11F_B10F)), i === t.RGBA) {
            const e = s ? L : mt.getTransfer(r);
            a === t.FLOAT && (o = t.RGBA32F), a === t.HALF_FLOAT && (o = t.RGBA16F), a === t.UNSIGNED_BYTE && (o = "srgb" === e ? t.SRGB8_ALPHA8 : t.RGBA8), a === t.UNSIGNED_SHORT_4_4_4_4 && (o = t.RGBA4), a === t.UNSIGNED_SHORT_5_5_5_1 && (o = t.RGB5_A1)
        }
        return o !== t.R16F && o !== t.R32F && o !== t.RG16F && o !== t.RG32F && o !== t.RGBA16F && o !== t.RGBA32F || e.get("EXT_color_buffer_float"), o
    }

    function C(e, n) {
        let i;
        return e ? null === n || 1014 === n || 1020 === n ? i = t.DEPTH24_STENCIL8 : 1015 === n ? i = t.DEPTH32F_STENCIL8 : 1012 === n && (i = t.DEPTH24_STENCIL8, k("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")) : null === n || 1014 === n || 1020 === n ? i = t.DEPTH_COMPONENT24 : 1015 === n ? i = t.DEPTH_COMPONENT32F : 1012 === n && (i = t.DEPTH_COMPONENT16), i
    }

    function P(t, e) {
        return !0 === T(t) || t.isFramebufferTexture && 1003 !== t.minFilter && 1006 !== t.minFilter ? Math.log2(Math.max(e.width, e.height)) + 1 : void 0 !== t.mipmaps && t.mipmaps.length > 0 ? t.mipmaps.length : t.isCompressedTexture && Array.isArray(t.image) ? e.mipmaps.length : 1
    }

    function D(t) {
        const e = t.target;
        e.removeEventListener("dispose", D),
            function(t) {
                const e = i.get(t);
                if (void 0 === e.__webglInit) return;
                const n = t.source,
                    a = b.get(n);
                if (a) {
                    const i = a[e.__cacheKey];
                    i.usedTimes--, 0 === i.usedTimes && U(t), 0 === Object.keys(a).length && b.delete(n)
                }
                i.remove(t)
            }(e), e.isVideoTexture && x.delete(e)
    }

    function I(e) {
        const n = e.target;
        n.removeEventListener("dispose", I),
            function(e) {
                const n = i.get(e);
                e.depthTexture && (e.depthTexture.dispose(), i.remove(e.depthTexture));
                if (e.isWebGLCubeRenderTarget)
                    for (let i = 0; i < 6; i++) {
                        if (Array.isArray(n.__webglFramebuffer[i]))
                            for (let e = 0; e < n.__webglFramebuffer[i].length; e++) t.deleteFramebuffer(n.__webglFramebuffer[i][e]);
                        else t.deleteFramebuffer(n.__webglFramebuffer[i]);
                        n.__webglDepthbuffer && t.deleteRenderbuffer(n.__webglDepthbuffer[i])
                    } else {
                        if (Array.isArray(n.__webglFramebuffer))
                            for (let e = 0; e < n.__webglFramebuffer.length; e++) t.deleteFramebuffer(n.__webglFramebuffer[e]);
                        else t.deleteFramebuffer(n.__webglFramebuffer);
                        if (n.__webglDepthbuffer && t.deleteRenderbuffer(n.__webglDepthbuffer), n.__webglMultisampledFramebuffer && t.deleteFramebuffer(n.__webglMultisampledFramebuffer), n.__webglColorRenderbuffer)
                            for (let e = 0; e < n.__webglColorRenderbuffer.length; e++) n.__webglColorRenderbuffer[e] && t.deleteRenderbuffer(n.__webglColorRenderbuffer[e]);
                        n.__webglDepthRenderbuffer && t.deleteRenderbuffer(n.__webglDepthRenderbuffer)
                    }
                const a = e.textures;
                for (let r = 0, o = a.length; r < o; r++) {
                    const e = i.get(a[r]);
                    e.__webglTexture && (t.deleteTexture(e.__webglTexture), s.memory.textures--), i.remove(a[r])
                }
                i.remove(e)
            }(n)
    }

    function U(e) {
        const n = i.get(e);
        t.deleteTexture(n.__webglTexture);
        const a = e.source;
        delete b.get(a)[n.__cacheKey], s.memory.textures--
    }
    let N = 0;

    function F(e, a) {
        const r = i.get(e);
        if (e.isVideoTexture && function(t) {
                const e = s.render.frame;
                x.get(t) !== e && (x.set(t, e), t.update())
            }(e), !1 === e.isRenderTargetTexture && !0 !== e.isExternalTexture && e.version > 0 && r.__version !== e.version) {
            const t = e.image;
            if (null === t) k("WebGLRenderer: Texture marked for update but no image data found.");
            else {
                if (!1 !== t.complete) return void Y(r, e, a);
                k("WebGLRenderer: Texture marked for update but image is incomplete")
            }
        } else e.isExternalTexture && (r.__webglTexture = e.sourceTexture ? e.sourceTexture : null);
        n.bindTexture(t.TEXTURE_2D, r.__webglTexture, t.TEXTURE0 + a)
    }
    const B = {
            [l]: t.REPEAT,
            [c]: t.CLAMP_TO_EDGE,
            [h]: t.MIRRORED_REPEAT
        },
        z = {
            [u]: t.NEAREST,
            [d]: t.NEAREST_MIPMAP_NEAREST,
            [p]: t.NEAREST_MIPMAP_LINEAR,
            [m]: t.LINEAR,
            [f]: t.LINEAR_MIPMAP_NEAREST,
            [g]: t.LINEAR_MIPMAP_LINEAR
        },
        V = {
            512: t.NEVER,
            519: t.ALWAYS,
            513: t.LESS,
            515: t.LEQUAL,
            514: t.EQUAL,
            518: t.GEQUAL,
            516: t.GREATER,
            517: t.NOTEQUAL
        };

    function G(n, r) {
        if (1015 !== r.type || !1 !== e.has("OES_texture_float_linear") || 1006 !== r.magFilter && 1007 !== r.magFilter && 1005 !== r.magFilter && 1008 !== r.magFilter && 1006 !== r.minFilter && 1007 !== r.minFilter && 1005 !== r.minFilter && 1008 !== r.minFilter || k("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."), t.texParameteri(n, t.TEXTURE_WRAP_S, B[r.wrapS]), t.texParameteri(n, t.TEXTURE_WRAP_T, B[r.wrapT]), n !== t.TEXTURE_3D && n !== t.TEXTURE_2D_ARRAY || t.texParameteri(n, t.TEXTURE_WRAP_R, B[r.wrapR]), t.texParameteri(n, t.TEXTURE_MAG_FILTER, z[r.magFilter]), t.texParameteri(n, t.TEXTURE_MIN_FILTER, z[r.minFilter]), r.compareFunction && (t.texParameteri(n, t.TEXTURE_COMPARE_MODE, t.COMPARE_REF_TO_TEXTURE), t.texParameteri(n, t.TEXTURE_COMPARE_FUNC, V[r.compareFunction])), !0 === e.has("EXT_texture_filter_anisotropic")) {
            if (1003 === r.magFilter) return;
            if (1005 !== r.minFilter && 1008 !== r.minFilter) return;
            if (1015 === r.type && !1 === e.has("OES_texture_float_linear")) return;
            if (r.anisotropy > 1 || i.get(r).__currentAnisotropy) {
                const s = e.get("EXT_texture_filter_anisotropic");
                t.texParameterf(n, s.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(r.anisotropy, a.getMaxAnisotropy())), i.get(r).__currentAnisotropy = r.anisotropy
            }
        }
    }

    function W(e, n) {
        let i = !1;
        void 0 === e.__webglInit && (e.__webglInit = !0, n.addEventListener("dispose", D));
        const a = n.source;
        let r = b.get(a);
        void 0 === r && (r = {}, b.set(a, r));
        const o = function(t) {
            const e = [];
            return e.push(t.wrapS), e.push(t.wrapT), e.push(t.wrapR || 0), e.push(t.magFilter), e.push(t.minFilter), e.push(t.anisotropy), e.push(t.internalFormat), e.push(t.format), e.push(t.type), e.push(t.generateMipmaps), e.push(t.premultiplyAlpha), e.push(t.flipY), e.push(t.unpackAlignment), e.push(t.colorSpace), e.join()
        }(n);
        if (o !== e.__cacheKey) {
            void 0 === r[o] && (r[o] = {
                texture: t.createTexture(),
                usedTimes: 0
            }, s.memory.textures++, i = !0), r[o].usedTimes++;
            const a = r[e.__cacheKey];
            void 0 !== a && (r[e.__cacheKey].usedTimes--, 0 === a.usedTimes && U(n)), e.__cacheKey = o, e.__webglTexture = r[o].texture
        }
        return i
    }

    function X(t, e, n) {
        return Math.floor(Math.floor(t / n) / e)
    }

    function Y(e, s, o) {
        let l = t.TEXTURE_2D;
        (s.isDataArrayTexture || s.isCompressedArrayTexture) && (l = t.TEXTURE_2D_ARRAY), s.isData3DTexture && (l = t.TEXTURE_3D);
        const c = W(e, s),
            h = s.source;
        n.bindTexture(l, e.__webglTexture, t.TEXTURE0 + o);
        const u = i.get(h);
        if (h.version !== u.__version || !0 === c) {
            n.activeTexture(t.TEXTURE0 + o);
            const e = mt.getPrimaries(mt.workingColorSpace),
                i = "" === s.colorSpace ? null : mt.getPrimaries(s.colorSpace),
                d = "" === s.colorSpace || e === i ? t.NONE : t.BROWSER_DEFAULT_WEBGL;
            t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL, s.flipY), t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL, s.premultiplyAlpha), t.pixelStorei(t.UNPACK_ALIGNMENT, s.unpackAlignment), t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL, d);
            let p = E(s.image, !1, a.maxTextureSize);
            p = et(s, p);
            const m = r.convert(s.format, s.colorSpace),
                f = r.convert(s.type);
            let g, _ = R(s.internalFormat, m, f, s.colorSpace, s.isVideoTexture);
            G(l, s);
            const v = s.mipmaps,
                x = !0 !== s.isVideoTexture,
                M = void 0 === u.__version || !0 === c,
                b = h.dataReady,
                y = P(s, p);
            if (s.isDepthTexture) _ = C(1027 === s.format, s.type), M && (x ? n.texStorage2D(t.TEXTURE_2D, 1, _, p.width, p.height) : n.texImage2D(t.TEXTURE_2D, 0, _, p.width, p.height, 0, m, f, null));
            else if (s.isDataTexture)
                if (v.length > 0) {
                    x && M && n.texStorage2D(t.TEXTURE_2D, y, _, v[0].width, v[0].height);
                    for (let e = 0, i = v.length; e < i; e++) g = v[e], x ? b && n.texSubImage2D(t.TEXTURE_2D, e, 0, 0, g.width, g.height, m, f, g.data) : n.texImage2D(t.TEXTURE_2D, e, _, g.width, g.height, 0, m, f, g.data);
                    s.generateMipmaps = !1
                } else x ? (M && n.texStorage2D(t.TEXTURE_2D, y, _, p.width, p.height), b && function(e, i, a, r) {
                    const s = e.updateRanges;
                    if (0 === s.length) n.texSubImage2D(t.TEXTURE_2D, 0, 0, 0, i.width, i.height, a, r, i.data);
                    else {
                        s.sort((t, e) => t.start - e.start);
                        let o = 0;
                        for (let t = 1; t < s.length; t++) {
                            const e = s[o],
                                n = s[t],
                                a = e.start + e.count,
                                r = X(n.start, i.width, 4),
                                l = X(e.start, i.width, 4);
                            n.start <= a + 1 && r === l && X(n.start + n.count - 1, i.width, 4) === r ? e.count = Math.max(e.count, n.start + n.count - e.start) : (++o, s[o] = n)
                        }
                        s.length = o + 1;
                        const l = t.getParameter(t.UNPACK_ROW_LENGTH),
                            c = t.getParameter(t.UNPACK_SKIP_PIXELS),
                            h = t.getParameter(t.UNPACK_SKIP_ROWS);
                        t.pixelStorei(t.UNPACK_ROW_LENGTH, i.width);
                        for (let e = 0, u = s.length; e < u; e++) {
                            const o = s[e],
                                l = Math.floor(o.start / 4),
                                c = Math.ceil(o.count / 4),
                                h = l % i.width,
                                u = Math.floor(l / i.width),
                                d = c,
                                p = 1;
                            t.pixelStorei(t.UNPACK_SKIP_PIXELS, h), t.pixelStorei(t.UNPACK_SKIP_ROWS, u), n.texSubImage2D(t.TEXTURE_2D, 0, h, u, d, p, a, r, i.data)
                        }
                        e.clearUpdateRanges(), t.pixelStorei(t.UNPACK_ROW_LENGTH, l), t.pixelStorei(t.UNPACK_SKIP_PIXELS, c), t.pixelStorei(t.UNPACK_SKIP_ROWS, h)
                    }
                }(s, p, m, f)) : n.texImage2D(t.TEXTURE_2D, 0, _, p.width, p.height, 0, m, f, p.data);
            else if (s.isCompressedTexture)
                if (s.isCompressedArrayTexture) {
                    x && M && n.texStorage3D(t.TEXTURE_2D_ARRAY, y, _, v[0].width, v[0].height, p.depth);
                    for (let e = 0, i = v.length; e < i; e++)
                        if (g = v[e], 1023 !== s.format)
                            if (null !== m)
                                if (x) {
                                    if (b)
                                        if (s.layerUpdates.size > 0) {
                                            const i = da(g.width, g.height, s.format, s.type);
                                            for (const a of s.layerUpdates) {
                                                const r = g.data.subarray(a * i / g.data.BYTES_PER_ELEMENT, (a + 1) * i / g.data.BYTES_PER_ELEMENT);
                                                n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY, e, 0, 0, a, g.width, g.height, 1, m, r)
                                            }
                                            s.clearLayerUpdates()
                                        } else n.compressedTexSubImage3D(t.TEXTURE_2D_ARRAY, e, 0, 0, 0, g.width, g.height, p.depth, m, g.data)
                                } else n.compressedTexImage3D(t.TEXTURE_2D_ARRAY, e, _, g.width, g.height, p.depth, 0, g.data, 0, 0);
                    else k("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");
                    else x ? b && n.texSubImage3D(t.TEXTURE_2D_ARRAY, e, 0, 0, 0, g.width, g.height, p.depth, m, f, g.data) : n.texImage3D(t.TEXTURE_2D_ARRAY, e, _, g.width, g.height, p.depth, 0, m, f, g.data)
                } else {
                    x && M && n.texStorage2D(t.TEXTURE_2D, y, _, v[0].width, v[0].height);
                    for (let e = 0, i = v.length; e < i; e++) g = v[e], 1023 !== s.format ? null !== m ? x ? b && n.compressedTexSubImage2D(t.TEXTURE_2D, e, 0, 0, g.width, g.height, m, g.data) : n.compressedTexImage2D(t.TEXTURE_2D, e, _, g.width, g.height, 0, g.data) : k("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()") : x ? b && n.texSubImage2D(t.TEXTURE_2D, e, 0, 0, g.width, g.height, m, f, g.data) : n.texImage2D(t.TEXTURE_2D, e, _, g.width, g.height, 0, m, f, g.data)
                }
            else if (s.isDataArrayTexture)
                if (x) {
                    if (M && n.texStorage3D(t.TEXTURE_2D_ARRAY, y, _, p.width, p.height, p.depth), b)
                        if (s.layerUpdates.size > 0) {
                            const e = da(p.width, p.height, s.format, s.type);
                            for (const i of s.layerUpdates) {
                                const a = p.data.subarray(i * e / p.data.BYTES_PER_ELEMENT, (i + 1) * e / p.data.BYTES_PER_ELEMENT);
                                n.texSubImage3D(t.TEXTURE_2D_ARRAY, 0, 0, 0, i, p.width, p.height, 1, m, f, a)
                            }
                            s.clearLayerUpdates()
                        } else n.texSubImage3D(t.TEXTURE_2D_ARRAY, 0, 0, 0, 0, p.width, p.height, p.depth, m, f, p.data)
                } else n.texImage3D(t.TEXTURE_2D_ARRAY, 0, _, p.width, p.height, p.depth, 0, m, f, p.data);
            else if (s.isData3DTexture) x ? (M && n.texStorage3D(t.TEXTURE_3D, y, _, p.width, p.height, p.depth), b && n.texSubImage3D(t.TEXTURE_3D, 0, 0, 0, 0, p.width, p.height, p.depth, m, f, p.data)) : n.texImage3D(t.TEXTURE_3D, 0, _, p.width, p.height, p.depth, 0, m, f, p.data);
            else if (s.isFramebufferTexture) {
                if (M)
                    if (x) n.texStorage2D(t.TEXTURE_2D, y, _, p.width, p.height);
                    else {
                        let e = p.width,
                            i = p.height;
                        for (let a = 0; a < y; a++) n.texImage2D(t.TEXTURE_2D, a, _, e, i, 0, m, f, null), e >>= 1, i >>= 1
                    }
            } else if (v.length > 0) {
                if (x && M) {
                    const e = nt(v[0]);
                    n.texStorage2D(t.TEXTURE_2D, y, _, e.width, e.height)
                }
                for (let e = 0, i = v.length; e < i; e++) g = v[e], x ? b && n.texSubImage2D(t.TEXTURE_2D, e, 0, 0, m, f, g) : n.texImage2D(t.TEXTURE_2D, e, _, m, f, g);
                s.generateMipmaps = !1
            } else if (x) {
                if (M) {
                    const e = nt(p);
                    n.texStorage2D(t.TEXTURE_2D, y, _, e.width, e.height)
                }
                b && n.texSubImage2D(t.TEXTURE_2D, 0, 0, 0, m, f, p)
            } else n.texImage2D(t.TEXTURE_2D, 0, _, m, f, p);
            T(s) && w(l), u.__version = h.version, s.onUpdate && s.onUpdate(s)
        }
        e.__version = s.version
    }

    function j(e, a, s, l, c, h) {
        const u = r.convert(s.format, s.colorSpace),
            d = r.convert(s.type),
            p = R(s.internalFormat, u, d, s.colorSpace),
            m = i.get(a),
            f = i.get(s);
        if (f.__renderTarget = a, !m.__hasExternalTextures) {
            const e = Math.max(1, a.width >> h),
                i = Math.max(1, a.height >> h);
            c === t.TEXTURE_3D || c === t.TEXTURE_2D_ARRAY ? n.texImage3D(c, h, p, e, i, a.depth, 0, u, d, null) : n.texImage2D(c, h, p, e, i, 0, u, d, null)
        }
        n.bindFramebuffer(t.FRAMEBUFFER, e), tt(a) ? o.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER, l, c, f.__webglTexture, 0, Q(a)) : (c === t.TEXTURE_2D || c >= t.TEXTURE_CUBE_MAP_POSITIVE_X && c <= t.TEXTURE_CUBE_MAP_NEGATIVE_Z) && t.framebufferTexture2D(t.FRAMEBUFFER, l, c, f.__webglTexture, h), n.bindFramebuffer(t.FRAMEBUFFER, null)
    }

    function q(e, n, i) {
        if (t.bindRenderbuffer(t.RENDERBUFFER, e), n.depthBuffer) {
            const a = n.depthTexture,
                r = a && a.isDepthTexture ? a.type : null,
                s = C(n.stencilBuffer, r),
                l = n.stencilBuffer ? t.DEPTH_STENCIL_ATTACHMENT : t.DEPTH_ATTACHMENT;
            tt(n) ? o.renderbufferStorageMultisampleEXT(t.RENDERBUFFER, Q(n), s, n.width, n.height) : i ? t.renderbufferStorageMultisample(t.RENDERBUFFER, Q(n), s, n.width, n.height) : t.renderbufferStorage(t.RENDERBUFFER, s, n.width, n.height), t.framebufferRenderbuffer(t.FRAMEBUFFER, l, t.RENDERBUFFER, e)
        } else {
            const e = n.textures;
            for (let a = 0; a < e.length; a++) {
                const s = e[a],
                    l = r.convert(s.format, s.colorSpace),
                    c = r.convert(s.type),
                    h = R(s.internalFormat, l, c, s.colorSpace);
                tt(n) ? o.renderbufferStorageMultisampleEXT(t.RENDERBUFFER, Q(n), h, n.width, n.height) : i ? t.renderbufferStorageMultisample(t.RENDERBUFFER, Q(n), h, n.width, n.height) : t.renderbufferStorage(t.RENDERBUFFER, h, n.width, n.height)
            }
        }
        t.bindRenderbuffer(t.RENDERBUFFER, null)
    }

    function Z(e, a, s) {
        const l = !0 === a.isWebGLCubeRenderTarget;
        if (n.bindFramebuffer(t.FRAMEBUFFER, e), !a.depthTexture || !a.depthTexture.isDepthTexture) throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");
        const c = i.get(a.depthTexture);
        if (c.__renderTarget = a, c.__webglTexture && a.depthTexture.image.width === a.width && a.depthTexture.image.height === a.height || (a.depthTexture.image.width = a.width, a.depthTexture.image.height = a.height, a.depthTexture.needsUpdate = !0), l) {
            if (void 0 === c.__webglInit && (c.__webglInit = !0, a.depthTexture.addEventListener("dispose", D)), void 0 === c.__webglTexture) {
                c.__webglTexture = t.createTexture(), n.bindTexture(t.TEXTURE_CUBE_MAP, c.__webglTexture), G(t.TEXTURE_CUBE_MAP, a.depthTexture);
                const e = r.convert(a.depthTexture.format),
                    i = r.convert(a.depthTexture.type);
                let s;
                1026 === a.depthTexture.format ? s = t.DEPTH_COMPONENT24 : 1027 === a.depthTexture.format && (s = t.DEPTH24_STENCIL8);
                for (let n = 0; n < 6; n++) t.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + n, 0, s, a.width, a.height, 0, e, i, null)
            }
        } else F(a.depthTexture, 0);
        const h = c.__webglTexture,
            u = Q(a),
            d = l ? t.TEXTURE_CUBE_MAP_POSITIVE_X + s : t.TEXTURE_2D,
            p = 1027 === a.depthTexture.format ? t.DEPTH_STENCIL_ATTACHMENT : t.DEPTH_ATTACHMENT;
        if (1026 === a.depthTexture.format) tt(a) ? o.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER, p, d, h, 0, u) : t.framebufferTexture2D(t.FRAMEBUFFER, p, d, h, 0);
        else {
            if (1027 !== a.depthTexture.format) throw new Error("Unknown depthTexture format");
            tt(a) ? o.framebufferTexture2DMultisampleEXT(t.FRAMEBUFFER, p, d, h, 0, u) : t.framebufferTexture2D(t.FRAMEBUFFER, p, d, h, 0)
        }
    }

    function K(e) {
        const a = i.get(e),
            r = !0 === e.isWebGLCubeRenderTarget;
        if (a.__boundDepthTexture !== e.depthTexture) {
            const t = e.depthTexture;
            if (a.__depthDisposeCallback && a.__depthDisposeCallback(), t) {
                const e = () => {
                    delete a.__boundDepthTexture, delete a.__depthDisposeCallback, t.removeEventListener("dispose", e)
                };
                t.addEventListener("dispose", e), a.__depthDisposeCallback = e
            }
            a.__boundDepthTexture = t
        }
        if (e.depthTexture && !a.__autoAllocateDepthBuffer)
            if (r)
                for (let t = 0; t < 6; t++) Z(a.__webglFramebuffer[t], e, t);
            else {
                const t = e.texture.mipmaps;
                t && t.length > 0 ? Z(a.__webglFramebuffer[0], e, 0) : Z(a.__webglFramebuffer, e, 0)
            }
        else if (r) {
            a.__webglDepthbuffer = [];
            for (let i = 0; i < 6; i++)
                if (n.bindFramebuffer(t.FRAMEBUFFER, a.__webglFramebuffer[i]), void 0 === a.__webglDepthbuffer[i]) a.__webglDepthbuffer[i] = t.createRenderbuffer(), q(a.__webglDepthbuffer[i], e, !1);
                else {
                    const n = e.stencilBuffer ? t.DEPTH_STENCIL_ATTACHMENT : t.DEPTH_ATTACHMENT,
                        r = a.__webglDepthbuffer[i];
                    t.bindRenderbuffer(t.RENDERBUFFER, r), t.framebufferRenderbuffer(t.FRAMEBUFFER, n, t.RENDERBUFFER, r)
                }
        } else {
            const i = e.texture.mipmaps;
            if (i && i.length > 0 ? n.bindFramebuffer(t.FRAMEBUFFER, a.__webglFramebuffer[0]) : n.bindFramebuffer(t.FRAMEBUFFER, a.__webglFramebuffer), void 0 === a.__webglDepthbuffer) a.__webglDepthbuffer = t.createRenderbuffer(), q(a.__webglDepthbuffer, e, !1);
            else {
                const n = e.stencilBuffer ? t.DEPTH_STENCIL_ATTACHMENT : t.DEPTH_ATTACHMENT,
                    i = a.__webglDepthbuffer;
                t.bindRenderbuffer(t.RENDERBUFFER, i), t.framebufferRenderbuffer(t.FRAMEBUFFER, n, t.RENDERBUFFER, i)
            }
        }
        n.bindFramebuffer(t.FRAMEBUFFER, null)
    }
    const J = [],
        $ = [];

    function Q(t) {
        return Math.min(a.maxSamples, t.samples)
    }

    function tt(t) {
        const n = i.get(t);
        return t.samples > 0 && !0 === e.has("WEBGL_multisampled_render_to_texture") && !1 !== n.__useRenderToTexture
    }

    function et(t, e) {
        const n = t.colorSpace,
            i = t.format,
            a = t.type;
        return !0 === t.isCompressedTexture || !0 === t.isVideoTexture || "srgb-linear" !== n && "" !== n && ("srgb" === mt.getTransfer(n) ? 1023 === i && 1009 === a || k("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.") : H("WebGLTextures: Unsupported texture color space:", n)), e
    }

    function nt(t) {
        return "undefined" != typeof HTMLImageElement && t instanceof HTMLImageElement ? (v.width = t.naturalWidth || t.width, v.height = t.naturalHeight || t.height) : "undefined" != typeof VideoFrame && t instanceof VideoFrame ? (v.width = t.displayWidth, v.height = t.displayHeight) : (v.width = t.width, v.height = t.height), v
    }
    this.allocateTextureUnit = function() {
        const t = N;
        return t >= a.maxTextures && k("WebGLTextures: Trying to use " + t + " texture units while this GPU supports only " + a.maxTextures), N += 1, t
    }, this.resetTextureUnits = function() {
        N = 0
    }, this.setTexture2D = F, this.setTexture2DArray = function(e, a) {
        const r = i.get(e);
        !1 === e.isRenderTargetTexture && e.version > 0 && r.__version !== e.version ? Y(r, e, a) : (e.isExternalTexture && (r.__webglTexture = e.sourceTexture ? e.sourceTexture : null), n.bindTexture(t.TEXTURE_2D_ARRAY, r.__webglTexture, t.TEXTURE0 + a))
    }, this.setTexture3D = function(e, a) {
        const r = i.get(e);
        !1 === e.isRenderTargetTexture && e.version > 0 && r.__version !== e.version ? Y(r, e, a) : n.bindTexture(t.TEXTURE_3D, r.__webglTexture, t.TEXTURE0 + a)
    }, this.setTextureCube = function(e, s) {
        const o = i.get(e);
        !0 !== e.isCubeDepthTexture && e.version > 0 && o.__version !== e.version ? function(e, s, o) {
            if (6 !== s.image.length) return;
            const l = W(e, s),
                c = s.source;
            n.bindTexture(t.TEXTURE_CUBE_MAP, e.__webglTexture, t.TEXTURE0 + o);
            const h = i.get(c);
            if (c.version !== h.__version || !0 === l) {
                n.activeTexture(t.TEXTURE0 + o);
                const e = mt.getPrimaries(mt.workingColorSpace),
                    i = "" === s.colorSpace ? null : mt.getPrimaries(s.colorSpace),
                    u = "" === s.colorSpace || e === i ? t.NONE : t.BROWSER_DEFAULT_WEBGL;
                t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL, s.flipY), t.pixelStorei(t.UNPACK_PREMULTIPLY_ALPHA_WEBGL, s.premultiplyAlpha), t.pixelStorei(t.UNPACK_ALIGNMENT, s.unpackAlignment), t.pixelStorei(t.UNPACK_COLORSPACE_CONVERSION_WEBGL, u);
                const d = s.isCompressedTexture || s.image[0].isCompressedTexture,
                    p = s.image[0] && s.image[0].isDataTexture,
                    m = [];
                for (let t = 0; t < 6; t++) m[t] = d || p ? p ? s.image[t].image : s.image[t] : E(s.image[t], !0, a.maxCubemapSize), m[t] = et(s, m[t]);
                const f = m[0],
                    g = r.convert(s.format, s.colorSpace),
                    _ = r.convert(s.type),
                    v = R(s.internalFormat, g, _, s.colorSpace),
                    x = !0 !== s.isVideoTexture,
                    M = void 0 === h.__version || !0 === l,
                    b = c.dataReady;
                let y, S = P(s, f);
                if (G(t.TEXTURE_CUBE_MAP, s), d) {
                    x && M && n.texStorage2D(t.TEXTURE_CUBE_MAP, S, v, f.width, f.height);
                    for (let e = 0; e < 6; e++) {
                        y = m[e].mipmaps;
                        for (let i = 0; i < y.length; i++) {
                            const a = y[i];
                            1023 !== s.format ? null !== g ? x ? b && n.compressedTexSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, i, 0, 0, a.width, a.height, g, a.data) : n.compressedTexImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, i, v, a.width, a.height, 0, a.data) : k("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()") : x ? b && n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, i, 0, 0, a.width, a.height, g, _, a.data) : n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, i, v, a.width, a.height, 0, g, _, a.data)
                        }
                    }
                } else {
                    if (y = s.mipmaps, x && M) {
                        y.length > 0 && S++;
                        const e = nt(m[0]);
                        n.texStorage2D(t.TEXTURE_CUBE_MAP, S, v, e.width, e.height)
                    }
                    for (let e = 0; e < 6; e++)
                        if (p) {
                            x ? b && n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, 0, 0, 0, m[e].width, m[e].height, g, _, m[e].data) : n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, 0, v, m[e].width, m[e].height, 0, g, _, m[e].data);
                            for (let i = 0; i < y.length; i++) {
                                const a = y[i].image[e].image;
                                x ? b && n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, i + 1, 0, 0, a.width, a.height, g, _, a.data) : n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, i + 1, v, a.width, a.height, 0, g, _, a.data)
                            }
                        } else {
                            x ? b && n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, 0, 0, 0, g, _, m[e]) : n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, 0, v, g, _, m[e]);
                            for (let i = 0; i < y.length; i++) {
                                const a = y[i];
                                x ? b && n.texSubImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, i + 1, 0, 0, g, _, a.image[e]) : n.texImage2D(t.TEXTURE_CUBE_MAP_POSITIVE_X + e, i + 1, v, g, _, a.image[e])
                            }
                        }
                }
                T(s) && w(t.TEXTURE_CUBE_MAP), h.__version = c.version, s.onUpdate && s.onUpdate(s)
            }
            e.__version = s.version
        }(o, e, s) : n.bindTexture(t.TEXTURE_CUBE_MAP, o.__webglTexture, t.TEXTURE0 + s)
    }, this.rebindTextures = function(e, n, a) {
        const r = i.get(e);
        void 0 !== n && j(r.__webglFramebuffer, e, e.texture, t.COLOR_ATTACHMENT0, t.TEXTURE_2D, 0), void 0 !== a && K(e)
    }, this.setupRenderTarget = function(e) {
        const a = e.texture,
            o = i.get(e),
            l = i.get(a);
        e.addEventListener("dispose", I);
        const c = e.textures,
            h = !0 === e.isWebGLCubeRenderTarget,
            u = c.length > 1;
        if (u || (void 0 === l.__webglTexture && (l.__webglTexture = t.createTexture()), l.__version = a.version, s.memory.textures++), h) {
            o.__webglFramebuffer = [];
            for (let e = 0; e < 6; e++)
                if (a.mipmaps && a.mipmaps.length > 0) {
                    o.__webglFramebuffer[e] = [];
                    for (let n = 0; n < a.mipmaps.length; n++) o.__webglFramebuffer[e][n] = t.createFramebuffer()
                } else o.__webglFramebuffer[e] = t.createFramebuffer()
        } else {
            if (a.mipmaps && a.mipmaps.length > 0) {
                o.__webglFramebuffer = [];
                for (let e = 0; e < a.mipmaps.length; e++) o.__webglFramebuffer[e] = t.createFramebuffer()
            } else o.__webglFramebuffer = t.createFramebuffer();
            if (u)
                for (let e = 0, n = c.length; e < n; e++) {
                    const n = i.get(c[e]);
                    void 0 === n.__webglTexture && (n.__webglTexture = t.createTexture(), s.memory.textures++)
                }
            if (e.samples > 0 && !1 === tt(e)) {
                o.__webglMultisampledFramebuffer = t.createFramebuffer(), o.__webglColorRenderbuffer = [], n.bindFramebuffer(t.FRAMEBUFFER, o.__webglMultisampledFramebuffer);
                for (let n = 0; n < c.length; n++) {
                    const i = c[n];
                    o.__webglColorRenderbuffer[n] = t.createRenderbuffer(), t.bindRenderbuffer(t.RENDERBUFFER, o.__webglColorRenderbuffer[n]);
                    const a = r.convert(i.format, i.colorSpace),
                        s = r.convert(i.type),
                        l = R(i.internalFormat, a, s, i.colorSpace, !0 === e.isXRRenderTarget),
                        h = Q(e);
                    t.renderbufferStorageMultisample(t.RENDERBUFFER, h, l, e.width, e.height), t.framebufferRenderbuffer(t.FRAMEBUFFER, t.COLOR_ATTACHMENT0 + n, t.RENDERBUFFER, o.__webglColorRenderbuffer[n])
                }
                t.bindRenderbuffer(t.RENDERBUFFER, null), e.depthBuffer && (o.__webglDepthRenderbuffer = t.createRenderbuffer(), q(o.__webglDepthRenderbuffer, e, !0)), n.bindFramebuffer(t.FRAMEBUFFER, null)
            }
        }
        if (h) {
            n.bindTexture(t.TEXTURE_CUBE_MAP, l.__webglTexture), G(t.TEXTURE_CUBE_MAP, a);
            for (let n = 0; n < 6; n++)
                if (a.mipmaps && a.mipmaps.length > 0)
                    for (let i = 0; i < a.mipmaps.length; i++) j(o.__webglFramebuffer[n][i], e, a, t.COLOR_ATTACHMENT0, t.TEXTURE_CUBE_MAP_POSITIVE_X + n, i);
                else j(o.__webglFramebuffer[n], e, a, t.COLOR_ATTACHMENT0, t.TEXTURE_CUBE_MAP_POSITIVE_X + n, 0);
            T(a) && w(t.TEXTURE_CUBE_MAP), n.unbindTexture()
        } else if (u) {
            for (let a = 0, r = c.length; a < r; a++) {
                const r = c[a],
                    s = i.get(r);
                let l = t.TEXTURE_2D;
                (e.isWebGL3DRenderTarget || e.isWebGLArrayRenderTarget) && (l = e.isWebGL3DRenderTarget ? t.TEXTURE_3D : t.TEXTURE_2D_ARRAY), n.bindTexture(l, s.__webglTexture), G(l, r), j(o.__webglFramebuffer, e, r, t.COLOR_ATTACHMENT0 + a, l, 0), T(r) && w(l)
            }
            n.unbindTexture()
        } else {
            let i = t.TEXTURE_2D;
            if ((e.isWebGL3DRenderTarget || e.isWebGLArrayRenderTarget) && (i = e.isWebGL3DRenderTarget ? t.TEXTURE_3D : t.TEXTURE_2D_ARRAY), n.bindTexture(i, l.__webglTexture), G(i, a), a.mipmaps && a.mipmaps.length > 0)
                for (let n = 0; n < a.mipmaps.length; n++) j(o.__webglFramebuffer[n], e, a, t.COLOR_ATTACHMENT0, i, n);
            else j(o.__webglFramebuffer, e, a, t.COLOR_ATTACHMENT0, i, 0);
            T(a) && w(i), n.unbindTexture()
        }
        e.depthBuffer && K(e)
    }, this.updateRenderTargetMipmap = function(t) {
        const e = t.textures;
        for (let a = 0, r = e.length; a < r; a++) {
            const r = e[a];
            if (T(r)) {
                const e = A(t),
                    a = i.get(r).__webglTexture;
                n.bindTexture(e, a), w(e), n.unbindTexture()
            }
        }
    }, this.updateMultisampleRenderTarget = function(e) {
        if (e.samples > 0)
            if (!1 === tt(e)) {
                const a = e.textures,
                    r = e.width,
                    s = e.height;
                let o = t.COLOR_BUFFER_BIT;
                const l = e.stencilBuffer ? t.DEPTH_STENCIL_ATTACHMENT : t.DEPTH_ATTACHMENT,
                    c = i.get(e),
                    h = a.length > 1;
                if (h)
                    for (let e = 0; e < a.length; e++) n.bindFramebuffer(t.FRAMEBUFFER, c.__webglMultisampledFramebuffer), t.framebufferRenderbuffer(t.FRAMEBUFFER, t.COLOR_ATTACHMENT0 + e, t.RENDERBUFFER, null), n.bindFramebuffer(t.FRAMEBUFFER, c.__webglFramebuffer), t.framebufferTexture2D(t.DRAW_FRAMEBUFFER, t.COLOR_ATTACHMENT0 + e, t.TEXTURE_2D, null, 0);
                n.bindFramebuffer(t.READ_FRAMEBUFFER, c.__webglMultisampledFramebuffer);
                const u = e.texture.mipmaps;
                u && u.length > 0 ? n.bindFramebuffer(t.DRAW_FRAMEBUFFER, c.__webglFramebuffer[0]) : n.bindFramebuffer(t.DRAW_FRAMEBUFFER, c.__webglFramebuffer);
                for (let n = 0; n < a.length; n++) {
                    if (e.resolveDepthBuffer && (e.depthBuffer && (o |= t.DEPTH_BUFFER_BIT), e.stencilBuffer && e.resolveStencilBuffer && (o |= t.STENCIL_BUFFER_BIT)), h) {
                        t.framebufferRenderbuffer(t.READ_FRAMEBUFFER, t.COLOR_ATTACHMENT0, t.RENDERBUFFER, c.__webglColorRenderbuffer[n]);
                        const e = i.get(a[n]).__webglTexture;
                        t.framebufferTexture2D(t.DRAW_FRAMEBUFFER, t.COLOR_ATTACHMENT0, t.TEXTURE_2D, e, 0)
                    }
                    t.blitFramebuffer(0, 0, r, s, 0, 0, r, s, o, t.NEAREST), !0 === _ && (J.length = 0, $.length = 0, J.push(t.COLOR_ATTACHMENT0 + n), e.depthBuffer && !1 === e.resolveDepthBuffer && (J.push(l), $.push(l), t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER, $)), t.invalidateFramebuffer(t.READ_FRAMEBUFFER, J))
                }
                if (n.bindFramebuffer(t.READ_FRAMEBUFFER, null), n.bindFramebuffer(t.DRAW_FRAMEBUFFER, null), h)
                    for (let e = 0; e < a.length; e++) {
                        n.bindFramebuffer(t.FRAMEBUFFER, c.__webglMultisampledFramebuffer), t.framebufferRenderbuffer(t.FRAMEBUFFER, t.COLOR_ATTACHMENT0 + e, t.RENDERBUFFER, c.__webglColorRenderbuffer[e]);
                        const r = i.get(a[e]).__webglTexture;
                        n.bindFramebuffer(t.FRAMEBUFFER, c.__webglFramebuffer), t.framebufferTexture2D(t.DRAW_FRAMEBUFFER, t.COLOR_ATTACHMENT0 + e, t.TEXTURE_2D, r, 0)
                    }
                n.bindFramebuffer(t.DRAW_FRAMEBUFFER, c.__webglMultisampledFramebuffer)
            } else if (e.depthBuffer && !1 === e.resolveDepthBuffer && _) {
            const n = e.stencilBuffer ? t.DEPTH_STENCIL_ATTACHMENT : t.DEPTH_ATTACHMENT;
            t.invalidateFramebuffer(t.DRAW_FRAMEBUFFER, [n])
        }
    }, this.setupDepthRenderbuffer = K, this.setupFrameBufferTexture = j, this.useMultisampledRTT = tt, this.isReversedDepthBuffer = function() {
        return n.buffers.depth.getReversed()
    }
}

function Zs(t, e) {
    return {
        convert: function(n, i = "") {
            let a;
            const r = mt.getTransfer(i);
            if (1009 === n) return t.UNSIGNED_BYTE;
            if (1017 === n) return t.UNSIGNED_SHORT_4_4_4_4;
            if (1018 === n) return t.UNSIGNED_SHORT_5_5_5_1;
            if (35902 === n) return t.UNSIGNED_INT_5_9_9_9_REV;
            if (35899 === n) return t.UNSIGNED_INT_10F_11F_11F_REV;
            if (1010 === n) return t.BYTE;
            if (1011 === n) return t.SHORT;
            if (1012 === n) return t.UNSIGNED_SHORT;
            if (1013 === n) return t.INT;
            if (1014 === n) return t.UNSIGNED_INT;
            if (1015 === n) return t.FLOAT;
            if (1016 === n) return t.HALF_FLOAT;
            if (1021 === n) return t.ALPHA;
            if (1022 === n) return t.RGB;
            if (1023 === n) return t.RGBA;
            if (1026 === n) return t.DEPTH_COMPONENT;
            if (1027 === n) return t.DEPTH_STENCIL;
            if (1028 === n) return t.RED;
            if (1029 === n) return t.RED_INTEGER;
            if (1030 === n) return t.RG;
            if (1031 === n) return t.RG_INTEGER;
            if (1033 === n) return t.RGBA_INTEGER;
            if (33776 === n || 33777 === n || 33778 === n || 33779 === n)
                if ("srgb" === r) {
                    if (a = e.get("WEBGL_compressed_texture_s3tc_srgb"), null === a) return null;
                    if (33776 === n) return a.COMPRESSED_SRGB_S3TC_DXT1_EXT;
                    if (33777 === n) return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;
                    if (33778 === n) return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;
                    if (33779 === n) return a.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT
                } else {
                    if (a = e.get("WEBGL_compressed_texture_s3tc"), null === a) return null;
                    if (33776 === n) return a.COMPRESSED_RGB_S3TC_DXT1_EXT;
                    if (33777 === n) return a.COMPRESSED_RGBA_S3TC_DXT1_EXT;
                    if (33778 === n) return a.COMPRESSED_RGBA_S3TC_DXT3_EXT;
                    if (33779 === n) return a.COMPRESSED_RGBA_S3TC_DXT5_EXT
                } if (35840 === n || 35841 === n || 35842 === n || 35843 === n) {
                if (a = e.get("WEBGL_compressed_texture_pvrtc"), null === a) return null;
                if (35840 === n) return a.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;
                if (35841 === n) return a.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;
                if (35842 === n) return a.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;
                if (35843 === n) return a.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG
            }
            if (36196 === n || 37492 === n || 37496 === n || 37488 === n || 37489 === n || 37490 === n || 37491 === n) {
                if (a = e.get("WEBGL_compressed_texture_etc"), null === a) return null;
                if (36196 === n || 37492 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ETC2 : a.COMPRESSED_RGB8_ETC2;
                if (37496 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC : a.COMPRESSED_RGBA8_ETC2_EAC;
                if (37488 === n) return a.COMPRESSED_R11_EAC;
                if (37489 === n) return a.COMPRESSED_SIGNED_R11_EAC;
                if (37490 === n) return a.COMPRESSED_RG11_EAC;
                if (37491 === n) return a.COMPRESSED_SIGNED_RG11_EAC
            }
            if (37808 === n || 37809 === n || 37810 === n || 37811 === n || 37812 === n || 37813 === n || 37814 === n || 37815 === n || 37816 === n || 37817 === n || 37818 === n || 37819 === n || 37820 === n || 37821 === n) {
                if (a = e.get("WEBGL_compressed_texture_astc"), null === a) return null;
                if (37808 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR : a.COMPRESSED_RGBA_ASTC_4x4_KHR;
                if (37809 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR : a.COMPRESSED_RGBA_ASTC_5x4_KHR;
                if (37810 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR : a.COMPRESSED_RGBA_ASTC_5x5_KHR;
                if (37811 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR : a.COMPRESSED_RGBA_ASTC_6x5_KHR;
                if (37812 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR : a.COMPRESSED_RGBA_ASTC_6x6_KHR;
                if (37813 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR : a.COMPRESSED_RGBA_ASTC_8x5_KHR;
                if (37814 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR : a.COMPRESSED_RGBA_ASTC_8x6_KHR;
                if (37815 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR : a.COMPRESSED_RGBA_ASTC_8x8_KHR;
                if (37816 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR : a.COMPRESSED_RGBA_ASTC_10x5_KHR;
                if (37817 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR : a.COMPRESSED_RGBA_ASTC_10x6_KHR;
                if (37818 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR : a.COMPRESSED_RGBA_ASTC_10x8_KHR;
                if (37819 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR : a.COMPRESSED_RGBA_ASTC_10x10_KHR;
                if (37820 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR : a.COMPRESSED_RGBA_ASTC_12x10_KHR;
                if (37821 === n) return "srgb" === r ? a.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR : a.COMPRESSED_RGBA_ASTC_12x12_KHR
            }
            if (36492 === n || 36494 === n || 36495 === n) {
                if (a = e.get("EXT_texture_compression_bptc"), null === a) return null;
                if (36492 === n) return "srgb" === r ? a.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT : a.COMPRESSED_RGBA_BPTC_UNORM_EXT;
                if (36494 === n) return a.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;
                if (36495 === n) return a.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT
            }
            if (36283 === n || 36284 === n || 36285 === n || 36286 === n) {
                if (a = e.get("EXT_texture_compression_rgtc"), null === a) return null;
                if (36283 === n) return a.COMPRESSED_RED_RGTC1_EXT;
                if (36284 === n) return a.COMPRESSED_SIGNED_RED_RGTC1_EXT;
                if (36285 === n) return a.COMPRESSED_RED_GREEN_RGTC2_EXT;
                if (36286 === n) return a.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT
            }
            return 1020 === n ? t.UNSIGNED_INT_24_8 : void 0 !== t[n] ? t[n] : null
        }
    }
}
var Ks = class {
        constructor() {
            this.texture = null, this.mesh = null, this.depthNear = 0, this.depthFar = 0
        }
        init(t, e) {
            if (null === this.texture) {
                const n = new hi(t.texture);
                t.depthNear === e.depthNear && t.depthFar === e.depthFar || (this.depthNear = t.depthNear, this.depthFar = t.depthFar), this.texture = n
            }
        }
        getMesh(t) {
            if (null !== this.texture && null === this.mesh) {
                const e = t.cameras[0].viewport,
                    n = new _i({
                        vertexShader: "\nvoid main() {\n\n\tgl_Position = vec4( position, 1.0 );\n\n}",
                        fragmentShader: "\nuniform sampler2DArray depthColor;\nuniform float depthWidth;\nuniform float depthHeight;\n\nvoid main() {\n\n\tvec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );\n\n\tif ( coord.x >= 1.0 ) {\n\n\t\tgl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;\n\n\t} else {\n\n\t\tgl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;\n\n\t}\n\n}",
                        uniforms: {
                            depthColor: {
                                value: this.texture
                            },
                            depthWidth: {
                                value: e.z
                            },
                            depthHeight: {
                                value: e.w
                            }
                        }
                    });
                this.mesh = new Zn(new di(20, 20), n)
            }
            return this.mesh
        }
        reset() {
            this.texture = null, this.mesh = null
        }
        getDepthTexture() {
            return this.texture
        }
    },
    Js = class extends X {
        constructor(t, e) {
            super();
            const n = this;
            let i = null,
                a = 1,
                r = null,
                s = "local-floor",
                o = 1,
                l = null,
                c = null,
                h = null,
                u = null,
                d = null,
                p = null;
            const m = "undefined" != typeof XRWebGLBinding,
                f = new Ks,
                g = {},
                v = e.getContextAttributes();
            let M = null,
                b = null;
            const y = [],
                S = [],
                w = new it;
            let A = null;
            const R = new Xi;
            R.viewport = new Et;
            const C = new Xi;
            C.viewport = new Et;
            const P = [R, C],
                D = new $i;
            let L = null,
                I = null;

            function U(t) {
                const e = S.indexOf(t.inputSource);
                if (-1 === e) return;
                const n = y[e];
                void 0 !== n && (n.update(t.inputSource, t.frame, l || r), n.dispatchEvent({
                    type: t.type,
                    data: t.inputSource
                }))
            }

            function N() {
                i.removeEventListener("select", U), i.removeEventListener("selectstart", U), i.removeEventListener("selectend", U), i.removeEventListener("squeeze", U), i.removeEventListener("squeezestart", U), i.removeEventListener("squeezeend", U), i.removeEventListener("end", N), i.removeEventListener("inputsourceschange", O);
                for (let t = 0; t < y.length; t++) {
                    const e = S[t];
                    null !== e && (S[t] = null, y[t].disconnect(e))
                }
                L = null, I = null, f.reset();
                for (const t in g) delete g[t];
                t.setRenderTarget(M), d = null, u = null, h = null, i = null, b = null, H.stop(), n.isPresenting = !1, t.setPixelRatio(A), t.setSize(w.width, w.height, !1), n.dispatchEvent({
                    type: "sessionend"
                })
            }

            function O(t) {
                for (let e = 0; e < t.removed.length; e++) {
                    const n = t.removed[e],
                        i = S.indexOf(n);
                    i >= 0 && (S[i] = null, y[i].disconnect(n))
                }
                for (let e = 0; e < t.added.length; e++) {
                    const n = t.added[e];
                    let i = S.indexOf(n);
                    if (-1 === i) {
                        for (let t = 0; t < y.length; t++) {
                            if (t >= S.length) {
                                S.push(n), i = t;
                                break
                            }
                            if (null === S[t]) {
                                S[t] = n, i = t;
                                break
                            }
                        }
                        if (-1 === i) break
                    }
                    const a = y[i];
                    a && a.connect(n)
                }
            }
            this.cameraAutoUpdate = !0, this.enabled = !1, this.isPresenting = !1, this.getController = function(t) {
                let e = y[t];
                return void 0 === e && (e = new re, y[t] = e), e.getTargetRaySpace()
            }, this.getControllerGrip = function(t) {
                let e = y[t];
                return void 0 === e && (e = new re, y[t] = e), e.getGripSpace()
            }, this.getHand = function(t) {
                let e = y[t];
                return void 0 === e && (e = new re, y[t] = e), e.getHandSpace()
            }, this.setFramebufferScaleFactor = function(t) {
                a = t, !0 === n.isPresenting && k("WebXRManager: Cannot change framebuffer scale while presenting.")
            }, this.setReferenceSpaceType = function(t) {
                s = t, !0 === n.isPresenting && k("WebXRManager: Cannot change reference space type while presenting.")
            }, this.getReferenceSpace = function() {
                return l || r
            }, this.setReferenceSpace = function(t) {
                l = t
            }, this.getBaseLayer = function() {
                return null !== u ? u : d
            }, this.getBinding = function() {
                return null === h && m && (h = new XRWebGLBinding(i, e)), h
            }, this.getFrame = function() {
                return p
            }, this.getSession = function() {
                return i
            }, this.setSession = async function(c) {
                if (i = c, null !== i) {
                    if (M = t.getRenderTarget(), i.addEventListener("select", U), i.addEventListener("selectstart", U), i.addEventListener("selectend", U), i.addEventListener("squeeze", U), i.addEventListener("squeezestart", U), i.addEventListener("squeezeend", U), i.addEventListener("end", N), i.addEventListener("inputsourceschange", O), !0 !== v.xrCompatible && await e.makeXRCompatible(), A = t.getPixelRatio(), t.getSize(w), m && "createProjectionLayer" in XRWebGLBinding.prototype) {
                        let n = null,
                            r = null,
                            s = null;
                        v.depth && (s = v.stencil ? e.DEPTH24_STENCIL8 : e.DEPTH_COMPONENT24, n = v.stencil ? 1027 : T, r = v.stencil ? 1020 : x);
                        const o = {
                            colorFormat: e.RGBA8,
                            depthFormat: s,
                            scaleFactor: a
                        };
                        h = this.getBinding(), u = h.createProjectionLayer(o), i.updateRenderState({
                            layers: [u]
                        }), t.setPixelRatio(1), t.setSize(u.textureWidth, u.textureHeight, !1), b = new wt(u.textureWidth, u.textureHeight, {
                            format: E,
                            type: _,
                            depthTexture: new li(u.textureWidth, u.textureHeight, r, void 0, void 0, void 0, void 0, void 0, void 0, n),
                            stencilBuffer: v.stencil,
                            colorSpace: t.outputColorSpace,
                            samples: v.antialias ? 4 : 0,
                            resolveDepthBuffer: !1 === u.ignoreDepthValues,
                            resolveStencilBuffer: !1 === u.ignoreDepthValues
                        })
                    } else {
                        const n = {
                            antialias: v.antialias,
                            alpha: !0,
                            depth: v.depth,
                            stencil: v.stencil,
                            framebufferScaleFactor: a
                        };
                        d = new XRWebGLLayer(i, e, n), i.updateRenderState({
                            baseLayer: d
                        }), t.setPixelRatio(1), t.setSize(d.framebufferWidth, d.framebufferHeight, !1), b = new wt(d.framebufferWidth, d.framebufferHeight, {
                            format: E,
                            type: _,
                            colorSpace: t.outputColorSpace,
                            stencilBuffer: v.stencil,
                            resolveDepthBuffer: !1 === d.ignoreDepthValues,
                            resolveStencilBuffer: !1 === d.ignoreDepthValues
                        })
                    }
                    b.isXRRenderTarget = !0, this.setFoveation(o), l = null, r = await i.requestReferenceSpace(s), H.setContext(i), H.start(), n.isPresenting = !0, n.dispatchEvent({
                        type: "sessionstart"
                    })
                }
            }, this.getEnvironmentBlendMode = function() {
                if (null !== i) return i.environmentBlendMode
            }, this.getDepthTexture = function() {
                return f.getDepthTexture()
            };
            const F = new rt,
                B = new rt;

            function z(t, e) {
                null === e ? t.matrixWorld.copy(t.matrix) : t.matrixWorld.multiplyMatrices(e.matrixWorld, t.matrix), t.matrixWorldInverse.copy(t.matrixWorld).invert()
            }
            this.updateCamera = function(t) {
                if (null === i) return;
                let e = t.near,
                    n = t.far;
                null !== f.texture && (f.depthNear > 0 && (e = f.depthNear), f.depthFar > 0 && (n = f.depthFar)), D.near = C.near = R.near = e, D.far = C.far = R.far = n, L === D.near && I === D.far || (i.updateRenderState({
                    depthNear: D.near,
                    depthFar: D.far
                }), L = D.near, I = D.far), D.layers.mask = 6 | t.layers.mask, R.layers.mask = -5 & D.layers.mask, C.layers.mask = -3 & D.layers.mask;
                const a = t.parent,
                    r = D.cameras;
                z(D, a);
                for (let i = 0; i < r.length; i++) z(r[i], a);
                2 === r.length ? function(t, e, n) {
                        F.setFromMatrixPosition(e.matrixWorld), B.setFromMatrixPosition(n.matrixWorld);
                        const i = F.distanceTo(B),
                            a = e.projectionMatrix.elements,
                            r = n.projectionMatrix.elements,
                            s = a[14] / (a[10] - 1),
                            o = a[14] / (a[10] + 1),
                            l = (a[9] + 1) / a[5],
                            c = (a[9] - 1) / a[5],
                            h = (a[8] - 1) / a[0],
                            u = (r[8] + 1) / r[0],
                            d = s * h,
                            p = s * u,
                            m = i / (-h + u),
                            f = m * -h;
                        if (e.matrixWorld.decompose(t.position, t.quaternion, t.scale), t.translateX(f), t.translateZ(m), t.matrixWorld.compose(t.position, t.quaternion, t.scale), t.matrixWorldInverse.copy(t.matrixWorld).invert(), -1 === a[10]) t.projectionMatrix.copy(e.projectionMatrix), t.projectionMatrixInverse.copy(e.projectionMatrixInverse);
                        else {
                            const e = s + m,
                                n = o + m,
                                a = d - f,
                                r = p + (i - f),
                                h = l * o / n * e,
                                u = c * o / n * e;
                            t.projectionMatrix.makePerspective(a, r, h, u, e, n), t.projectionMatrixInverse.copy(t.projectionMatrix).invert()
                        }
                    }(D, R, C) : D.projectionMatrix.copy(R.projectionMatrix),
                    function(t, e, n) {
                        null === n ? t.matrix.copy(e.matrixWorld) : (t.matrix.copy(n.matrixWorld), t.matrix.invert(), t.matrix.multiply(e.matrixWorld));
                        t.matrix.decompose(t.position, t.quaternion, t.scale), t.updateMatrixWorld(!0), t.projectionMatrix.copy(e.projectionMatrix), t.projectionMatrixInverse.copy(e.projectionMatrixInverse), t.isPerspectiveCamera && (t.fov = 2 * Z * Math.atan(1 / t.projectionMatrix.elements[5]), t.zoom = 1)
                    }(t, D, a)
            }, this.getCamera = function() {
                return D
            }, this.getFoveation = function() {
                if (null !== u || null !== d) return o
            }, this.setFoveation = function(t) {
                o = t, null !== u && (u.fixedFoveation = t), null !== d && void 0 !== d.fixedFoveation && (d.fixedFoveation = t)
            }, this.hasDepthSensing = function() {
                return null !== f.texture
            }, this.getDepthSensingMesh = function() {
                return f.getMesh(D)
            }, this.getCameraTexture = function(t) {
                return g[t]
            };
            let V = null;
            const H = new pa;
            H.setAnimationLoop(function(e, a) {
                if (c = a.getViewerPose(l || r), p = a, null !== c) {
                    const e = c.views;
                    null !== d && (t.setRenderTargetFramebuffer(b, d.framebuffer), t.setRenderTarget(b));
                    let a = !1;
                    e.length !== D.cameras.length && (D.cameras.length = 0, a = !0);
                    for (let n = 0; n < e.length; n++) {
                        const i = e[n];
                        let r = null;
                        if (null !== d) r = d.getViewport(i);
                        else {
                            const e = h.getViewSubImage(u, i);
                            r = e.viewport, 0 === n && (t.setRenderTargetTextures(b, e.colorTexture, e.depthStencilTexture), t.setRenderTarget(b))
                        }
                        let s = P[n];
                        void 0 === s && (s = new Xi, s.layers.enable(n), s.viewport = new Et, P[n] = s), s.matrix.fromArray(i.transform.matrix), s.matrix.decompose(s.position, s.quaternion, s.scale), s.projectionMatrix.fromArray(i.projectionMatrix), s.projectionMatrixInverse.copy(s.projectionMatrix).invert(), s.viewport.set(r.x, r.y, r.width, r.height), 0 === n && (D.matrix.copy(s.matrix), D.matrix.decompose(D.position, D.quaternion, D.scale)), !0 === a && D.cameras.push(s)
                    }
                    const r = i.enabledFeatures;
                    if (r && r.includes("depth-sensing") && "gpu-optimized" == i.depthUsage && m) {
                        h = n.getBinding();
                        const t = h.getDepthInformation(e[0]);
                        t && t.isValid && t.texture && f.init(t, i.renderState)
                    }
                    if (r && r.includes("camera-access") && m) {
                        t.state.unbindTexture(), h = n.getBinding();
                        for (let t = 0; t < e.length; t++) {
                            const n = e[t].camera;
                            if (n) {
                                let t = g[n];
                                t || (t = new hi, g[n] = t);
                                const e = h.getCameraImage(n);
                                t.sourceTexture = e
                            }
                        }
                    }
                }
                for (let t = 0; t < y.length; t++) {
                    const e = S[t],
                        n = y[t];
                    null !== e && void 0 !== n && n.update(e, a, l || r)
                }
                V && V(e, a), a.detectedPlanes && n.dispatchEvent({
                    type: "planesdetected",
                    data: a
                }), p = null
            }), this.setAnimationLoop = function(t) {
                V = t
            }, this.dispose = function() {}
        }
    },
    $s = new zt,
    Qs = new Ct;

function to(t, e) {
    function n(t, e) {
        !0 === t.matrixAutoUpdate && t.updateMatrix(), e.value.copy(t.matrix)
    }

    function i(t, i) {
        t.opacity.value = i.opacity, i.color && t.diffuse.value.copy(i.color), i.emissive && t.emissive.value.copy(i.emissive).multiplyScalar(i.emissiveIntensity), i.map && (t.map.value = i.map, n(i.map, t.mapTransform)), i.alphaMap && (t.alphaMap.value = i.alphaMap, n(i.alphaMap, t.alphaMapTransform)), i.bumpMap && (t.bumpMap.value = i.bumpMap, n(i.bumpMap, t.bumpMapTransform), t.bumpScale.value = i.bumpScale, 1 === i.side && (t.bumpScale.value *= -1)), i.normalMap && (t.normalMap.value = i.normalMap, n(i.normalMap, t.normalMapTransform), t.normalScale.value.copy(i.normalScale), 1 === i.side && t.normalScale.value.negate()), i.displacementMap && (t.displacementMap.value = i.displacementMap, n(i.displacementMap, t.displacementMapTransform), t.displacementScale.value = i.displacementScale, t.displacementBias.value = i.displacementBias), i.emissiveMap && (t.emissiveMap.value = i.emissiveMap, n(i.emissiveMap, t.emissiveMapTransform)), i.specularMap && (t.specularMap.value = i.specularMap, n(i.specularMap, t.specularMapTransform)), i.alphaTest > 0 && (t.alphaTest.value = i.alphaTest);
        const a = e.get(i),
            r = a.envMap,
            s = a.envMapRotation;
        r && (t.envMap.value = r, $s.copy(s), $s.x *= -1, $s.y *= -1, $s.z *= -1, r.isCubeTexture && !1 === r.isRenderTargetTexture && ($s.y *= -1, $s.z *= -1), t.envMapRotation.value.setFromMatrix4(Qs.makeRotationFromEuler($s)), t.flipEnvMap.value = r.isCubeTexture && !1 === r.isRenderTargetTexture ? -1 : 1, t.reflectivity.value = i.reflectivity, t.ior.value = i.ior, t.refractionRatio.value = i.refractionRatio), i.lightMap && (t.lightMap.value = i.lightMap, t.lightMapIntensity.value = i.lightMapIntensity, n(i.lightMap, t.lightMapTransform)), i.aoMap && (t.aoMap.value = i.aoMap, t.aoMapIntensity.value = i.aoMapIntensity, n(i.aoMap, t.aoMapTransform))
    }
    return {
        refreshFogUniforms: function(e, n) {
            n.color.getRGB(e.fogColor.value, fi(t)), n.isFog ? (e.fogNear.value = n.near, e.fogFar.value = n.far) : n.isFogExp2 && (e.fogDensity.value = n.density)
        },
        refreshMaterialUniforms: function(t, a, r, s, o) {
            a.isMeshBasicMaterial ? i(t, a) : a.isMeshLambertMaterial ? (i(t, a), a.envMap && (t.envMapIntensity.value = a.envMapIntensity)) : a.isMeshToonMaterial ? (i(t, a), function(t, e) {
                e.gradientMap && (t.gradientMap.value = e.gradientMap)
            }(t, a)) : a.isMeshPhongMaterial ? (i(t, a), function(t, e) {
                t.specular.value.copy(e.specular), t.shininess.value = Math.max(e.shininess, 1e-4)
            }(t, a), a.envMap && (t.envMapIntensity.value = a.envMapIntensity)) : a.isMeshStandardMaterial ? (i(t, a), function(t, e) {
                t.metalness.value = e.metalness, e.metalnessMap && (t.metalnessMap.value = e.metalnessMap, n(e.metalnessMap, t.metalnessMapTransform));
                t.roughness.value = e.roughness, e.roughnessMap && (t.roughnessMap.value = e.roughnessMap, n(e.roughnessMap, t.roughnessMapTransform));
                e.envMap && (t.envMapIntensity.value = e.envMapIntensity)
            }(t, a), a.isMeshPhysicalMaterial && function(t, e, i) {
                t.ior.value = e.ior, e.sheen > 0 && (t.sheenColor.value.copy(e.sheenColor).multiplyScalar(e.sheen), t.sheenRoughness.value = e.sheenRoughness, e.sheenColorMap && (t.sheenColorMap.value = e.sheenColorMap, n(e.sheenColorMap, t.sheenColorMapTransform)), e.sheenRoughnessMap && (t.sheenRoughnessMap.value = e.sheenRoughnessMap, n(e.sheenRoughnessMap, t.sheenRoughnessMapTransform)));
                e.clearcoat > 0 && (t.clearcoat.value = e.clearcoat, t.clearcoatRoughness.value = e.clearcoatRoughness, e.clearcoatMap && (t.clearcoatMap.value = e.clearcoatMap, n(e.clearcoatMap, t.clearcoatMapTransform)), e.clearcoatRoughnessMap && (t.clearcoatRoughnessMap.value = e.clearcoatRoughnessMap, n(e.clearcoatRoughnessMap, t.clearcoatRoughnessMapTransform)), e.clearcoatNormalMap && (t.clearcoatNormalMap.value = e.clearcoatNormalMap, n(e.clearcoatNormalMap, t.clearcoatNormalMapTransform), t.clearcoatNormalScale.value.copy(e.clearcoatNormalScale), 1 === e.side && t.clearcoatNormalScale.value.negate()));
                e.dispersion > 0 && (t.dispersion.value = e.dispersion);
                e.iridescence > 0 && (t.iridescence.value = e.iridescence, t.iridescenceIOR.value = e.iridescenceIOR, t.iridescenceThicknessMinimum.value = e.iridescenceThicknessRange[0], t.iridescenceThicknessMaximum.value = e.iridescenceThicknessRange[1], e.iridescenceMap && (t.iridescenceMap.value = e.iridescenceMap, n(e.iridescenceMap, t.iridescenceMapTransform)), e.iridescenceThicknessMap && (t.iridescenceThicknessMap.value = e.iridescenceThicknessMap, n(e.iridescenceThicknessMap, t.iridescenceThicknessMapTransform)));
                e.transmission > 0 && (t.transmission.value = e.transmission, t.transmissionSamplerMap.value = i.texture, t.transmissionSamplerSize.value.set(i.width, i.height), e.transmissionMap && (t.transmissionMap.value = e.transmissionMap, n(e.transmissionMap, t.transmissionMapTransform)), t.thickness.value = e.thickness, e.thicknessMap && (t.thicknessMap.value = e.thicknessMap, n(e.thicknessMap, t.thicknessMapTransform)), t.attenuationDistance.value = e.attenuationDistance, t.attenuationColor.value.copy(e.attenuationColor));
                e.anisotropy > 0 && (t.anisotropyVector.value.set(e.anisotropy * Math.cos(e.anisotropyRotation), e.anisotropy * Math.sin(e.anisotropyRotation)), e.anisotropyMap && (t.anisotropyMap.value = e.anisotropyMap, n(e.anisotropyMap, t.anisotropyMapTransform)));
                t.specularIntensity.value = e.specularIntensity, t.specularColor.value.copy(e.specularColor), e.specularColorMap && (t.specularColorMap.value = e.specularColorMap, n(e.specularColorMap, t.specularColorMapTransform));
                e.specularIntensityMap && (t.specularIntensityMap.value = e.specularIntensityMap, n(e.specularIntensityMap, t.specularIntensityMapTransform))
            }(t, a, o)) : a.isMeshMatcapMaterial ? (i(t, a), function(t, e) {
                e.matcap && (t.matcap.value = e.matcap)
            }(t, a)) : a.isMeshDepthMaterial ? i(t, a) : a.isMeshDistanceMaterial ? (i(t, a), function(t, n) {
                const i = e.get(n).light;
                t.referencePosition.value.setFromMatrixPosition(i.matrixWorld), t.nearDistance.value = i.shadow.camera.near, t.farDistance.value = i.shadow.camera.far
            }(t, a)) : a.isMeshNormalMaterial ? i(t, a) : a.isLineBasicMaterial ? (function(t, e) {
                t.diffuse.value.copy(e.color), t.opacity.value = e.opacity, e.map && (t.map.value = e.map, n(e.map, t.mapTransform))
            }(t, a), a.isLineDashedMaterial && function(t, e) {
                t.dashSize.value = e.dashSize, t.totalSize.value = e.dashSize + e.gapSize, t.scale.value = e.scale
            }(t, a)) : a.isPointsMaterial ? function(t, e, i, a) {
                t.diffuse.value.copy(e.color), t.opacity.value = e.opacity, t.size.value = e.size * i, t.scale.value = .5 * a, e.map && (t.map.value = e.map, n(e.map, t.uvTransform));
                e.alphaMap && (t.alphaMap.value = e.alphaMap, n(e.alphaMap, t.alphaMapTransform));
                e.alphaTest > 0 && (t.alphaTest.value = e.alphaTest)
            }(t, a, r, s) : a.isSpriteMaterial ? function(t, e) {
                t.diffuse.value.copy(e.color), t.opacity.value = e.opacity, t.rotation.value = e.rotation, e.map && (t.map.value = e.map, n(e.map, t.mapTransform));
                e.alphaMap && (t.alphaMap.value = e.alphaMap, n(e.alphaMap, t.alphaMapTransform));
                e.alphaTest > 0 && (t.alphaTest.value = e.alphaTest)
            }(t, a) : a.isShadowMaterial ? (t.color.value.copy(a.color), t.opacity.value = a.opacity) : a.isShaderMaterial && (a.uniformsNeedUpdate = !1)
        }
    }
}

function eo(t, e, n, i) {
    let a = {},
        r = {},
        s = [];
    const o = t.getParameter(t.MAX_UNIFORM_BUFFER_BINDINGS);

    function l(t, e, n, i) {
        const a = t.value,
            r = e + "_" + n;
        if (void 0 === i[r]) return i[r] = "number" == typeof a || "boolean" == typeof a ? a : a.clone(), !0;
        {
            const t = i[r];
            if ("number" == typeof a || "boolean" == typeof a) {
                if (t !== a) return i[r] = a, !0
            } else if (!1 === t.equals(a)) return t.copy(a), !0
        }
        return !1
    }

    function c(t) {
        const e = {
            boundary: 0,
            storage: 0
        };
        return "number" == typeof t || "boolean" == typeof t ? (e.boundary = 4, e.storage = 4) : t.isVector2 ? (e.boundary = 8, e.storage = 8) : t.isVector3 || t.isColor ? (e.boundary = 16, e.storage = 12) : t.isVector4 ? (e.boundary = 16, e.storage = 16) : t.isMatrix3 ? (e.boundary = 48, e.storage = 48) : t.isMatrix4 ? (e.boundary = 64, e.storage = 64) : t.isTexture ? k("WebGLRenderer: Texture samplers can not be part of an uniforms group.") : k("WebGLRenderer: Unsupported uniform value type.", t), e
    }

    function h(e) {
        const n = e.target;
        n.removeEventListener("dispose", h);
        const i = s.indexOf(n.__bindingPointIndex);
        s.splice(i, 1), t.deleteBuffer(a[n.id]), delete a[n.id], delete r[n.id]
    }
    return {
        bind: function(t, e) {
            const n = e.program;
            i.uniformBlockBinding(t, n)
        },
        update: function(n, u) {
            let d = a[n.id];
            void 0 === d && (! function(t) {
                const e = t.uniforms;
                let n = 0;
                const i = 16;
                for (let r = 0, s = e.length; r < s; r++) {
                    const t = Array.isArray(e[r]) ? e[r] : [e[r]];
                    for (let e = 0, a = t.length; e < a; e++) {
                        const a = t[e],
                            r = Array.isArray(a.value) ? a.value : [a.value];
                        for (let t = 0, e = r.length; t < e; t++) {
                            const e = c(r[t]),
                                s = n % i,
                                o = s % e.boundary,
                                l = s + o;
                            n += o, 0 !== l && i - l < e.storage && (n += i - l), a.__data = new Float32Array(e.storage / Float32Array.BYTES_PER_ELEMENT), a.__offset = n, n += e.storage
                        }
                    }
                }
                const a = n % i;
                a > 0 && (n += i - a);
                t.__size = n, t.__cache = {}
            }(n), d = function(e) {
                const n = function() {
                    for (let t = 0; t < o; t++)
                        if (-1 === s.indexOf(t)) return s.push(t), t;
                    return H("WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."), 0
                }();
                e.__bindingPointIndex = n;
                const i = t.createBuffer(),
                    a = e.__size,
                    r = e.usage;
                return t.bindBuffer(t.UNIFORM_BUFFER, i), t.bufferData(t.UNIFORM_BUFFER, a, r), t.bindBuffer(t.UNIFORM_BUFFER, null), t.bindBufferBase(t.UNIFORM_BUFFER, n, i), i
            }(n), a[n.id] = d, n.addEventListener("dispose", h));
            const p = u.program;
            i.updateUBOMapping(n, p);
            const m = e.render.frame;
            r[n.id] !== m && (! function(e) {
                const n = a[e.id],
                    i = e.uniforms,
                    r = e.__cache;
                t.bindBuffer(t.UNIFORM_BUFFER, n);
                for (let a = 0, s = i.length; a < s; a++) {
                    const e = Array.isArray(i[a]) ? i[a] : [i[a]];
                    for (let n = 0, i = e.length; n < i; n++) {
                        const i = e[n];
                        if (!0 === l(i, a, n, r)) {
                            const e = i.__offset,
                                n = Array.isArray(i.value) ? i.value : [i.value];
                            let a = 0;
                            for (let r = 0; r < n.length; r++) {
                                const s = n[r],
                                    o = c(s);
                                "number" == typeof s || "boolean" == typeof s ? (i.__data[0] = s, t.bufferSubData(t.UNIFORM_BUFFER, e + a, i.__data)) : s.isMatrix3 ? (i.__data[0] = s.elements[0], i.__data[1] = s.elements[1], i.__data[2] = s.elements[2], i.__data[3] = 0, i.__data[4] = s.elements[3], i.__data[5] = s.elements[4], i.__data[6] = s.elements[5], i.__data[7] = 0, i.__data[8] = s.elements[6], i.__data[9] = s.elements[7], i.__data[10] = s.elements[8], i.__data[11] = 0) : (s.toArray(i.__data, a), a += o.storage / Float32Array.BYTES_PER_ELEMENT)
                            }
                            t.bufferSubData(t.UNIFORM_BUFFER, e, i.__data)
                        }
                    }
                }
                t.bindBuffer(t.UNIFORM_BUFFER, null)
            }(n), r[n.id] = m)
        },
        dispose: function() {
            for (const e in a) t.deleteBuffer(a[e]);
            s = [], a = {}, r = {}
        }
    }
}
var no = new Uint16Array([12469, 15057, 12620, 14925, 13266, 14620, 13807, 14376, 14323, 13990, 14545, 13625, 14713, 13328, 14840, 12882, 14931, 12528, 14996, 12233, 15039, 11829, 15066, 11525, 15080, 11295, 15085, 10976, 15082, 10705, 15073, 10495, 13880, 14564, 13898, 14542, 13977, 14430, 14158, 14124, 14393, 13732, 14556, 13410, 14702, 12996, 14814, 12596, 14891, 12291, 14937, 11834, 14957, 11489, 14958, 11194, 14943, 10803, 14921, 10506, 14893, 10278, 14858, 9960, 14484, 14039, 14487, 14025, 14499, 13941, 14524, 13740, 14574, 13468, 14654, 13106, 14743, 12678, 14818, 12344, 14867, 11893, 14889, 11509, 14893, 11180, 14881, 10751, 14852, 10428, 14812, 10128, 14765, 9754, 14712, 9466, 14764, 13480, 14764, 13475, 14766, 13440, 14766, 13347, 14769, 13070, 14786, 12713, 14816, 12387, 14844, 11957, 14860, 11549, 14868, 11215, 14855, 10751, 14825, 10403, 14782, 10044, 14729, 9651, 14666, 9352, 14599, 9029, 14967, 12835, 14966, 12831, 14963, 12804, 14954, 12723, 14936, 12564, 14917, 12347, 14900, 11958, 14886, 11569, 14878, 11247, 14859, 10765, 14828, 10401, 14784, 10011, 14727, 9600, 14660, 9289, 14586, 8893, 14508, 8533, 15111, 12234, 15110, 12234, 15104, 12216, 15092, 12156, 15067, 12010, 15028, 11776, 14981, 11500, 14942, 11205, 14902, 10752, 14861, 10393, 14812, 9991, 14752, 9570, 14682, 9252, 14603, 8808, 14519, 8445, 14431, 8145, 15209, 11449, 15208, 11451, 15202, 11451, 15190, 11438, 15163, 11384, 15117, 11274, 15055, 10979, 14994, 10648, 14932, 10343, 14871, 9936, 14803, 9532, 14729, 9218, 14645, 8742, 14556, 8381, 14461, 8020, 14365, 7603, 15273, 10603, 15272, 10607, 15267, 10619, 15256, 10631, 15231, 10614, 15182, 10535, 15118, 10389, 15042, 10167, 14963, 9787, 14883, 9447, 14800, 9115, 14710, 8665, 14615, 8318, 14514, 7911, 14411, 7507, 14279, 7198, 15314, 9675, 15313, 9683, 15309, 9712, 15298, 9759, 15277, 9797, 15229, 9773, 15166, 9668, 15084, 9487, 14995, 9274, 14898, 8910, 14800, 8539, 14697, 8234, 14590, 7790, 14479, 7409, 14367, 7067, 14178, 6621, 15337, 8619, 15337, 8631, 15333, 8677, 15325, 8769, 15305, 8871, 15264, 8940, 15202, 8909, 15119, 8775, 15022, 8565, 14916, 8328, 14804, 8009, 14688, 7614, 14569, 7287, 14448, 6888, 14321, 6483, 14088, 6171, 15350, 7402, 15350, 7419, 15347, 7480, 15340, 7613, 15322, 7804, 15287, 7973, 15229, 8057, 15148, 8012, 15046, 7846, 14933, 7611, 14810, 7357, 14682, 7069, 14552, 6656, 14421, 6316, 14251, 5948, 14007, 5528, 15356, 5942, 15356, 5977, 15353, 6119, 15348, 6294, 15332, 6551, 15302, 6824, 15249, 7044, 15171, 7122, 15070, 7050, 14949, 6861, 14818, 6611, 14679, 6349, 14538, 6067, 14398, 5651, 14189, 5311, 13935, 4958, 15359, 4123, 15359, 4153, 15356, 4296, 15353, 4646, 15338, 5160, 15311, 5508, 15263, 5829, 15188, 6042, 15088, 6094, 14966, 6001, 14826, 5796, 14678, 5543, 14527, 5287, 14377, 4985, 14133, 4586, 13869, 4257, 15360, 1563, 15360, 1642, 15358, 2076, 15354, 2636, 15341, 3350, 15317, 4019, 15273, 4429, 15203, 4732, 15105, 4911, 14981, 4932, 14836, 4818, 14679, 4621, 14517, 4386, 14359, 4156, 14083, 3795, 13808, 3437, 15360, 122, 15360, 137, 15358, 285, 15355, 636, 15344, 1274, 15322, 2177, 15281, 2765, 15215, 3223, 15120, 3451, 14995, 3569, 14846, 3567, 14681, 3466, 14511, 3305, 14344, 3121, 14037, 2800, 13753, 2467, 15360, 0, 15360, 1, 15359, 21, 15355, 89, 15346, 253, 15325, 479, 15287, 796, 15225, 1148, 15133, 1492, 15008, 1749, 14856, 1882, 14685, 1886, 14506, 1783, 14324, 1608, 13996, 1398, 13702, 1183]),
    io = null;
var ao = class {
        constructor(t = {}) {
            const {
                canvas: e = F(),
                context: n = null,
                depth: i = !0,
                stencil: a = !1,
                alpha: r = !1,
                antialias: s = !1,
                premultipliedAlpha: o = !0,
                preserveDrawingBuffer: l = !1,
                powerPreference: h = "default",
                failIfMajorPerformanceCaveat: u = !1,
                reversedDepthBuffer: d = !1,
                outputBufferType: p = _
            } = t;
            let f;
            if (this.isWebGLRenderer = !0, null !== n) {
                if ("undefined" != typeof WebGLRenderingContext && n instanceof WebGLRenderingContext) throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");
                f = n.getContextAttributes().alpha
            } else f = r;
            const M = p,
                E = new Set([1033, 1031, 1029]),
                T = new Set([_, x, v, 1020, y, S]),
                A = new Uint32Array(4),
                R = new Int32Array(4);
            let C = null,
                L = null;
            const I = [],
                U = [];
            let O = null;
            this.domElement = e, this.debug = {
                checkShaderErrors: !0,
                onShaderError: null
            }, this.autoClear = !0, this.autoClearColor = !0, this.autoClearDepth = !0, this.autoClearStencil = !0, this.sortObjects = !0, this.clippingPlanes = [], this.localClippingEnabled = !1, this.toneMapping = 0, this.toneMappingExposure = 1, this.transmissionResolutionScale = 1;
            const B = this;
            let V = !1;
            this._outputColorSpace = P;
            let W = 0,
                X = 0,
                Y = null,
                j = -1,
                q = null;
            const Z = new Et,
                K = new Et;
            let J = null;
            const $ = new he(0);
            let Q = 0,
                tt = e.width,
                et = e.height,
                nt = 1,
                it = null,
                at = null;
            const st = new Et(0, 0, tt, et),
                ot = new Et(0, 0, tt, et);
            let lt = !1;
            const ct = new ri;
            let ht = !1,
                ut = !1;
            const dt = new Ct,
                pt = new rt,
                ft = new Et,
                gt = {
                    background: null,
                    fog: null,
                    environment: null,
                    overrideMaterial: null,
                    isScene: !0
                };
            let _t = !1;

            function vt() {
                return null === Y ? nt : 1
            }
            let xt, Mt, bt, yt, St, Tt, At, Rt, Pt, Dt, Lt, It, Ut, Nt, Ot, Ft, Bt, zt, Vt, kt, Ht, Gt, Wt, Xt = n;

            function Yt(t, n) {
                return e.getContext(t, n)
            }
            try {
                const t = {
                    alpha: !0,
                    depth: i,
                    stencil: a,
                    antialias: s,
                    premultipliedAlpha: o,
                    preserveDrawingBuffer: l,
                    powerPreference: h,
                    failIfMajorPerformanceCaveat: u
                };
                if ("setAttribute" in e && e.setAttribute("data-engine", "three.js r183"), e.addEventListener("webglcontextlost", Zt, !1), e.addEventListener("webglcontextrestored", Kt, !1), e.addEventListener("webglcontextcreationerror", Jt, !1), null === Xt) {
                    const e = "webgl2";
                    if (Xt = Yt(e, t), null === Xt) throw Yt(e) ? new Error("Error creating WebGL context with your selected attributes.") : new Error("Error creating WebGL context.")
                }
            } catch (ge) {
                throw H("WebGLRenderer: " + ge.message), ge
            }

            function jt() {
                xt = new Ga(Xt), xt.init(), Ht = new Zs(Xt, xt), Mt = new Ea(Xt, xt, t, Ht), bt = new js(Xt, xt), Mt.reversedDepthBuffer && d && bt.buffers.depth.setReversed(!0), yt = new Ya(Xt), St = new Ps, Tt = new qs(Xt, xt, bt, St, Mt, Ht, yt), At = new Ha(B), Rt = new ma(Xt), Gt = new ya(Xt, Rt), Pt = new Wa(Xt, Rt, yt, Gt), Dt = new qa(Xt, Pt, Rt, Gt, yt), zt = new ja(Xt, Mt, Tt), Ot = new Ta(St), Lt = new Cs(B, At, xt, Mt, Gt, Ot), It = new to(B, St), Ut = new Us, Nt = new Vs(xt), Bt = new ba(B, At, bt, Dt, f, o), Ft = new Ys(B, Dt, Mt), Wt = new eo(Xt, yt, Mt, bt), Vt = new Sa(Xt, xt, yt), kt = new Xa(Xt, xt, yt), yt.programs = Lt.programs, B.capabilities = Mt, B.extensions = xt, B.properties = St, B.renderLists = Ut, B.shadowMap = Ft, B.state = bt, B.info = yt
            }
            jt(), 1009 !== M && (O = new Ka(M, e.width, e.height, i, a));
            const qt = new Js(B, Xt);

            function Zt(t) {
                t.preventDefault(), z("WebGLRenderer: Context Lost."), V = !0
            }

            function Kt() {
                z("WebGLRenderer: Context Restored."), V = !1;
                const t = yt.autoReset,
                    e = Ft.enabled,
                    n = Ft.autoUpdate,
                    i = Ft.needsUpdate,
                    a = Ft.type;
                jt(), yt.autoReset = t, Ft.enabled = e, Ft.autoUpdate = n, Ft.needsUpdate = i, Ft.type = a
            }

            function Jt(t) {
                H("WebGLRenderer: A WebGL context could not be created. Reason: ", t.statusMessage)
            }

            function $t(t) {
                const e = t.target;
                e.removeEventListener("dispose", $t),
                    function(t) {
                        (function(t) {
                            const e = St.get(t).programs;
                            void 0 !== e && (e.forEach(function(t) {
                                Lt.releaseProgram(t)
                            }), t.isShaderMaterial && Lt.releaseShaderCache(t))
                        })(t), St.remove(t)
                    }(e)
            }

            function Qt(t, e, n) {
                !0 === t.transparent && 2 === t.side && !1 === t.forceSinglePass ? (t.side = 1, t.needsUpdate = !0, ce(t, e, n), t.side = 0, t.needsUpdate = !0, ce(t, e, n), t.side = 2) : ce(t, e, n)
            }
            this.xr = qt, this.getContext = function() {
                return Xt
            }, this.getContextAttributes = function() {
                return Xt.getContextAttributes()
            }, this.forceContextLoss = function() {
                const t = xt.get("WEBGL_lose_context");
                t && t.loseContext()
            }, this.forceContextRestore = function() {
                const t = xt.get("WEBGL_lose_context");
                t && t.restoreContext()
            }, this.getPixelRatio = function() {
                return nt
            }, this.setPixelRatio = function(t) {
                void 0 !== t && (nt = t, this.setSize(tt, et, !1))
            }, this.getSize = function(t) {
                return t.set(tt, et)
            }, this.setSize = function(t, n, i = !0) {
                qt.isPresenting ? k("WebGLRenderer: Can't change size while VR device is presenting.") : (tt = t, et = n, e.width = Math.floor(t * nt), e.height = Math.floor(n * nt), !0 === i && (e.style.width = t + "px", e.style.height = n + "px"), null !== O && O.setSize(e.width, e.height), this.setViewport(0, 0, t, n))
            }, this.getDrawingBufferSize = function(t) {
                return t.set(tt * nt, et * nt).floor()
            }, this.setDrawingBufferSize = function(t, n, i) {
                tt = t, et = n, nt = i, e.width = Math.floor(t * i), e.height = Math.floor(n * i), this.setViewport(0, 0, t, n)
            }, this.setEffects = function(t) {
                if (1009 !== M) {
                    if (t)
                        for (let e = 0; e < t.length && !0 !== t[e].isOutputPass; e++);
                    O.setEffects(t || [])
                }
            }, this.getCurrentViewport = function(t) {
                return t.copy(Z)
            }, this.getViewport = function(t) {
                return t.copy(st)
            }, this.setViewport = function(t, e, n, i) {
                t.isVector4 ? st.set(t.x, t.y, t.z, t.w) : st.set(t, e, n, i), bt.viewport(Z.copy(st).multiplyScalar(nt).round())
            }, this.getScissor = function(t) {
                return t.copy(ot)
            }, this.setScissor = function(t, e, n, i) {
                t.isVector4 ? ot.set(t.x, t.y, t.z, t.w) : ot.set(t, e, n, i), bt.scissor(K.copy(ot).multiplyScalar(nt).round())
            }, this.getScissorTest = function() {
                return lt
            }, this.setScissorTest = function(t) {
                bt.setScissorTest(lt = t)
            }, this.setOpaqueSort = function(t) {
                it = t
            }, this.setTransparentSort = function(t) {
                at = t
            }, this.getClearColor = function(t) {
                return t.copy(Bt.getClearColor())
            }, this.setClearColor = function() {
                Bt.setClearColor(...arguments)
            }, this.getClearAlpha = function() {
                return Bt.getClearAlpha()
            }, this.setClearAlpha = function() {
                Bt.setClearAlpha(...arguments)
            }, this.clear = function(t = !0, e = !0, n = !0) {
                let i = 0;
                if (t) {
                    let t = !1;
                    if (null !== Y) {
                        const e = Y.texture.format;
                        t = E.has(e)
                    }
                    if (t) {
                        const t = Y.texture.type,
                            e = T.has(t),
                            n = Bt.getClearColor(),
                            i = Bt.getClearAlpha(),
                            a = n.r,
                            r = n.g,
                            s = n.b;
                        e ? (A[0] = a, A[1] = r, A[2] = s, A[3] = i, Xt.clearBufferuiv(Xt.COLOR, 0, A)) : (R[0] = a, R[1] = r, R[2] = s, R[3] = i, Xt.clearBufferiv(Xt.COLOR, 0, R))
                    } else i |= Xt.COLOR_BUFFER_BIT
                }
                e && (i |= Xt.DEPTH_BUFFER_BIT), n && (i |= Xt.STENCIL_BUFFER_BIT, this.state.buffers.stencil.setMask(4294967295)), 0 !== i && Xt.clear(i)
            }, this.clearColor = function() {
                this.clear(!0, !1, !1)
            }, this.clearDepth = function() {
                this.clear(!1, !0, !1)
            }, this.clearStencil = function() {
                this.clear(!1, !1, !0)
            }, this.dispose = function() {
                e.removeEventListener("webglcontextlost", Zt, !1), e.removeEventListener("webglcontextrestored", Kt, !1), e.removeEventListener("webglcontextcreationerror", Jt, !1), Bt.dispose(), Ut.dispose(), Nt.dispose(), St.dispose(), At.dispose(), Dt.dispose(), Gt.dispose(), Wt.dispose(), Lt.dispose(), qt.dispose(), qt.removeEventListener("sessionstart", ee), qt.removeEventListener("sessionend", ne), ie.stop()
            }, this.renderBufferDirect = function(t, e, n, i, a, r) {
                null === e && (e = gt);
                const s = a.isMesh && a.matrixWorld.determinant() < 0,
                    o = function(t, e, n, i, a) {
                        !0 !== e.isScene && (e = gt);
                        Tt.resetTextureUnits();
                        const r = e.fog,
                            s = i.isMeshStandardMaterial || i.isMeshLambertMaterial || i.isMeshPhongMaterial ? e.environment : null,
                            o = null === Y ? B.outputColorSpace : !0 === Y.isXRRenderTarget ? Y.texture.colorSpace : D,
                            l = i.isMeshStandardMaterial || i.isMeshLambertMaterial && !i.envMap || i.isMeshPhongMaterial && !i.envMap,
                            h = At.get(i.envMap || s, l),
                            u = !0 === i.vertexColors && !!n.attributes.color && 4 === n.attributes.color.itemSize,
                            d = !!n.attributes.tangent && (!!i.normalMap || i.anisotropy > 0),
                            p = !!n.morphAttributes.position,
                            f = !!n.morphAttributes.normal,
                            g = !!n.morphAttributes.color;
                        let _ = 0;
                        i.toneMapped && (null !== Y && !0 !== Y.isXRRenderTarget || (_ = B.toneMapping));
                        const v = n.morphAttributes.position || n.morphAttributes.normal || n.morphAttributes.color,
                            x = void 0 !== v ? v.length : 0,
                            M = St.get(i),
                            y = L.state.lights;
                        if (!0 === ht && (!0 === ut || t !== q)) {
                            const e = t === q && i.id === j;
                            Ot.setState(i, t, e)
                        }
                        let S = !1;
                        i.version === M.__version ? M.needsLights && M.lightsStateVersion !== y.state.version || M.outputColorSpace !== o || a.isBatchedMesh && !1 === M.batching ? S = !0 : a.isBatchedMesh || !0 !== M.batching ? a.isBatchedMesh && !0 === M.batchingColor && null === a.colorTexture || a.isBatchedMesh && !1 === M.batchingColor && null !== a.colorTexture || a.isInstancedMesh && !1 === M.instancing ? S = !0 : a.isInstancedMesh || !0 !== M.instancing ? a.isSkinnedMesh && !1 === M.skinning ? S = !0 : a.isSkinnedMesh || !0 !== M.skinning ? a.isInstancedMesh && !0 === M.instancingColor && null === a.instanceColor || a.isInstancedMesh && !1 === M.instancingColor && null !== a.instanceColor || a.isInstancedMesh && !0 === M.instancingMorph && null === a.morphTexture || a.isInstancedMesh && !1 === M.instancingMorph && null !== a.morphTexture || M.envMap !== h || !0 === i.fog && M.fog !== r ? S = !0 : void 0 === M.numClippingPlanes || M.numClippingPlanes === Ot.numPlanes && M.numIntersection === Ot.numIntersection ? (M.vertexAlphas !== u || M.vertexTangents !== d || M.morphTargets !== p || M.morphNormals !== f || M.morphColors !== g || M.toneMapping !== _ || M.morphTargetsCount !== x) && (S = !0) : S = !0 : S = !0 : S = !0 : S = !0 : (S = !0, M.__version = i.version);
                        let E = M.currentProgram;
                        !0 === S && (E = ce(i, e, a));
                        let T = !1,
                            A = !1,
                            R = !1;
                        const C = E.getUniforms(),
                            P = M.uniforms;
                        bt.useProgram(E.program) && (T = !0, A = !0, R = !0);
                        i.id !== j && (j = i.id, A = !0);
                        if (T || q !== t) {
                            bt.buffers.depth.getReversed() && !0 !== t.reversedDepth && (t._reversedDepth = !0, t.updateProjectionMatrix()), C.setValue(Xt, "projectionMatrix", t.projectionMatrix), C.setValue(Xt, "viewMatrix", t.matrixWorldInverse);
                            const e = C.map.cameraPosition;
                            void 0 !== e && e.setValue(Xt, pt.setFromMatrixPosition(t.matrixWorld)), Mt.logarithmicDepthBuffer && C.setValue(Xt, "logDepthBufFC", 2 / (Math.log(t.far + 1) / Math.LN2)), (i.isMeshPhongMaterial || i.isMeshToonMaterial || i.isMeshLambertMaterial || i.isMeshBasicMaterial || i.isMeshStandardMaterial || i.isShaderMaterial) && C.setValue(Xt, "isOrthographic", !0 === t.isOrthographicCamera), q !== t && (q = t, A = !0, R = !0)
                        }
                        M.needsLights && (y.state.directionalShadowMap.length > 0 && C.setValue(Xt, "directionalShadowMap", y.state.directionalShadowMap, Tt), y.state.spotShadowMap.length > 0 && C.setValue(Xt, "spotShadowMap", y.state.spotShadowMap, Tt), y.state.pointShadowMap.length > 0 && C.setValue(Xt, "pointShadowMap", y.state.pointShadowMap, Tt));
                        if (a.isSkinnedMesh) {
                            C.setOptional(Xt, a, "bindMatrix"), C.setOptional(Xt, a, "bindMatrixInverse");
                            const t = a.skeleton;
                            t && (null === t.boneTexture && t.computeBoneTexture(), C.setValue(Xt, "boneTexture", t.boneTexture, Tt))
                        }
                        a.isBatchedMesh && (C.setOptional(Xt, a, "batchingTexture"), C.setValue(Xt, "batchingTexture", a._matricesTexture, Tt), C.setOptional(Xt, a, "batchingIdTexture"), C.setValue(Xt, "batchingIdTexture", a._indirectTexture, Tt), C.setOptional(Xt, a, "batchingColorTexture"), null !== a._colorsTexture && C.setValue(Xt, "batchingColorTexture", a._colorsTexture, Tt));
                        const I = n.morphAttributes;
                        void 0 === I.position && void 0 === I.normal && void 0 === I.color || zt.update(a, n, E);
                        (A || M.receiveShadow !== a.receiveShadow) && (M.receiveShadow = a.receiveShadow, C.setValue(Xt, "receiveShadow", a.receiveShadow));
                        (i.isMeshStandardMaterial || i.isMeshLambertMaterial || i.isMeshPhongMaterial) && null === i.envMap && null !== e.environment && (P.envMapIntensity.value = e.environmentIntensity);
                        void 0 !== P.dfgLUT && (P.dfgLUT.value = (null === io && ((io = new Jn(no, 16, 16, w, b)).name = "DFG_LUT", io.minFilter = m, io.magFilter = m, io.wrapS = c, io.wrapT = c, io.generateMipmaps = !1, io.needsUpdate = !0), io));
                        A && (C.setValue(Xt, "toneMappingExposure", B.toneMappingExposure), M.needsLights && (N = R, (U = P).ambientLightColor.needsUpdate = N, U.lightProbe.needsUpdate = N, U.directionalLights.needsUpdate = N, U.directionalLightShadows.needsUpdate = N, U.pointLights.needsUpdate = N, U.pointLightShadows.needsUpdate = N, U.spotLights.needsUpdate = N, U.spotLightShadows.needsUpdate = N, U.rectAreaLights.needsUpdate = N, U.hemisphereLights.needsUpdate = N), r && !0 === i.fog && It.refreshFogUniforms(P, r), It.refreshMaterialUniforms(P, i, nt, et, L.state.transmissionRenderTarget[t.id]), es.upload(Xt, ue(M), P, Tt));
                        var U, N;
                        i.isShaderMaterial && !0 === i.uniformsNeedUpdate && (es.upload(Xt, ue(M), P, Tt), i.uniformsNeedUpdate = !1);
                        i.isSpriteMaterial && C.setValue(Xt, "center", a.center);
                        if (C.setValue(Xt, "modelViewMatrix", a.modelViewMatrix), C.setValue(Xt, "normalMatrix", a.normalMatrix), C.setValue(Xt, "modelMatrix", a.matrixWorld), i.isShaderMaterial || i.isRawShaderMaterial) {
                            const t = i.uniformsGroups;
                            for (let e = 0, n = t.length; e < n; e++) {
                                const n = t[e];
                                Wt.update(n, E), Wt.bind(n, E)
                            }
                        }
                        return E
                    }(t, e, n, i, a);
                bt.setMaterial(i, s);
                let l = n.index,
                    h = 1;
                if (!0 === i.wireframe) {
                    if (l = Pt.getWireframeAttribute(n), void 0 === l) return;
                    h = 2
                }
                const u = n.drawRange,
                    d = n.attributes.position;
                let p = u.start * h,
                    f = (u.start + u.count) * h;
                null !== r && (p = Math.max(p, r.start * h), f = Math.min(f, (r.start + r.count) * h)), null !== l ? (p = Math.max(p, 0), f = Math.min(f, l.count)) : null != d && (p = Math.max(p, 0), f = Math.min(f, d.count));
                const g = f - p;
                if (g < 0 || g === 1 / 0) return;
                let _;
                Gt.setup(a, i, o, n, l);
                let v = Vt;
                if (null !== l && (_ = Rt.get(l), v = kt, v.setIndex(_)), a.isMesh) !0 === i.wireframe ? (bt.setLineWidth(i.wireframeLinewidth * vt()), v.setMode(Xt.LINES)) : v.setMode(Xt.TRIANGLES);
                else if (a.isLine) {
                    let t = i.linewidth;
                    void 0 === t && (t = 1), bt.setLineWidth(t * vt()), a.isLineSegments ? v.setMode(Xt.LINES) : a.isLineLoop ? v.setMode(Xt.LINE_LOOP) : v.setMode(Xt.LINE_STRIP)
                } else a.isPoints ? v.setMode(Xt.POINTS) : a.isSprite && v.setMode(Xt.TRIANGLES);
                if (a.isBatchedMesh)
                    if (null !== a._multiDrawInstances) G("WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."), v.renderMultiDrawInstances(a._multiDrawStarts, a._multiDrawCounts, a._multiDrawCount, a._multiDrawInstances);
                    else if (xt.get("WEBGL_multi_draw")) v.renderMultiDraw(a._multiDrawStarts, a._multiDrawCounts, a._multiDrawCount);
                else {
                    const t = a._multiDrawStarts,
                        e = a._multiDrawCounts,
                        n = a._multiDrawCount,
                        r = l ? Rt.get(l).bytesPerElement : 1,
                        s = St.get(i).currentProgram.getUniforms();
                    for (let i = 0; i < n; i++) s.setValue(Xt, "_gl_DrawID", i), v.render(t[i] / r, e[i])
                } else if (a.isInstancedMesh) v.renderInstances(p, g, a.count);
                else if (n.isInstancedBufferGeometry) {
                    const t = void 0 !== n._maxInstanceCount ? n._maxInstanceCount : 1 / 0,
                        e = Math.min(n.instanceCount, t);
                    v.renderInstances(p, g, e)
                } else v.render(p, g)
            }, this.compile = function(t, e, n = null) {
                null === n && (n = t), L = Nt.get(n), L.init(e), U.push(L), n.traverseVisible(function(t) {
                    t.isLight && t.layers.test(e.layers) && (L.pushLight(t), t.castShadow && L.pushShadow(t))
                }), t !== n && t.traverseVisible(function(t) {
                    t.isLight && t.layers.test(e.layers) && (L.pushLight(t), t.castShadow && L.pushShadow(t))
                }), L.setupLights();
                const i = new Set;
                return t.traverse(function(t) {
                    if (!(t.isMesh || t.isPoints || t.isLine || t.isSprite)) return;
                    const e = t.material;
                    if (e)
                        if (Array.isArray(e))
                            for (let a = 0; a < e.length; a++) {
                                const r = e[a];
                                Qt(r, n, t), i.add(r)
                            } else Qt(e, n, t), i.add(e)
                }), L = U.pop(), i
            }, this.compileAsync = function(t, e, n = null) {
                const i = this.compile(t, e, n);
                return new Promise(e => {
                    function n() {
                        i.forEach(function(t) {
                            St.get(t).currentProgram.isReady() && i.delete(t)
                        }), 0 !== i.size ? setTimeout(n, 10) : e(t)
                    }
                    null !== xt.get("KHR_parallel_shader_compile") ? n() : setTimeout(n, 10)
                })
            };
            let te = null;

            function ee() {
                ie.stop()
            }

            function ne() {
                ie.start()
            }
            const ie = new pa;

            function ae(t, e, n, i) {
                if (!1 === t.visible) return;
                if (t.layers.test(e.layers))
                    if (t.isGroup) n = t.renderOrder;
                    else if (t.isLOD) !0 === t.autoUpdate && t.update(e);
                else if (t.isLight) L.pushLight(t), t.castShadow && L.pushShadow(t);
                else if (t.isSprite) {
                    if (!t.frustumCulled || ct.intersectsSprite(t)) {
                        i && ft.setFromMatrixPosition(t.matrixWorld).applyMatrix4(dt);
                        const e = Dt.update(t),
                            a = t.material;
                        a.visible && C.push(t, e, a, n, ft.z, null)
                    }
                } else if ((t.isMesh || t.isLine || t.isPoints) && (!t.frustumCulled || ct.intersectsObject(t))) {
                    const e = Dt.update(t),
                        a = t.material;
                    if (i && (void 0 !== t.boundingSphere ? (null === t.boundingSphere && t.computeBoundingSphere(), ft.copy(t.boundingSphere.center)) : (null === e.boundingSphere && e.computeBoundingSphere(), ft.copy(e.boundingSphere.center)), ft.applyMatrix4(t.matrixWorld).applyMatrix4(dt)), Array.isArray(a)) {
                        const i = e.groups;
                        for (let r = 0, s = i.length; r < s; r++) {
                            const s = i[r],
                                o = a[s.materialIndex];
                            o && o.visible && C.push(t, e, o, n, ft.z, s)
                        }
                    } else a.visible && C.push(t, e, a, n, ft.z, null)
                }
                const a = t.children;
                for (let r = 0, s = a.length; r < s; r++) ae(a[r], e, n, i)
            }

            function re(t, e, n, i) {
                const {
                    opaque: a,
                    transmissive: r,
                    transparent: s
                } = t;
                L.setupLightsView(n), !0 === ht && Ot.setGlobalState(B.clippingPlanes, n), i && bt.viewport(Z.copy(i)), a.length > 0 && oe(a, e, n), r.length > 0 && oe(r, e, n), s.length > 0 && oe(s, e, n), bt.buffers.depth.setTest(!0), bt.buffers.depth.setMask(!0), bt.buffers.color.setMask(!0), bt.setPolygonOffset(!1)
            }

            function se(t, e, n, i) {
                if (null !== (!0 === n.isScene ? n.overrideMaterial : null)) return;
                if (void 0 === L.state.transmissionRenderTarget[i.id]) {
                    const t = xt.has("EXT_color_buffer_half_float") || xt.has("EXT_color_buffer_float");
                    L.state.transmissionRenderTarget[i.id] = new wt(1, 1, {
                        generateMipmaps: !0,
                        type: t ? b : _,
                        minFilter: g,
                        samples: Math.max(4, Mt.samples),
                        stencilBuffer: a,
                        resolveDepthBuffer: !1,
                        resolveStencilBuffer: !1,
                        colorSpace: mt.workingColorSpace
                    })
                }
                const r = L.state.transmissionRenderTarget[i.id],
                    s = i.viewport || Z;
                r.setSize(s.z * B.transmissionResolutionScale, s.w * B.transmissionResolutionScale);
                const o = B.getRenderTarget(),
                    l = B.getActiveCubeFace(),
                    c = B.getActiveMipmapLevel();
                B.setRenderTarget(r), B.getClearColor($), Q = B.getClearAlpha(), Q < 1 && B.setClearColor(16777215, .5), B.clear(), _t && Bt.render(n);
                const h = B.toneMapping;
                B.toneMapping = 0;
                const u = i.viewport;
                if (void 0 !== i.viewport && (i.viewport = void 0), L.setupLightsView(i), !0 === ht && Ot.setGlobalState(B.clippingPlanes, i), oe(t, n, i), Tt.updateMultisampleRenderTarget(r), Tt.updateRenderTargetMipmap(r), !1 === xt.has("WEBGL_multisampled_render_to_texture")) {
                    let t = !1;
                    for (let a = 0, r = e.length; a < r; a++) {
                        const {
                            object: r,
                            geometry: s,
                            material: o,
                            group: l
                        } = e[a];
                        if (2 === o.side && r.layers.test(i.layers)) {
                            const e = o.side;
                            o.side = 1, o.needsUpdate = !0, le(r, n, i, s, o, l), o.side = e, o.needsUpdate = !0, t = !0
                        }
                    }!0 === t && (Tt.updateMultisampleRenderTarget(r), Tt.updateRenderTargetMipmap(r))
                }
                B.setRenderTarget(o, l, c), B.setClearColor($, Q), void 0 !== u && (i.viewport = u), B.toneMapping = h
            }

            function oe(t, e, n) {
                const i = !0 === e.isScene ? e.overrideMaterial : null;
                for (let a = 0, r = t.length; a < r; a++) {
                    const r = t[a],
                        {
                            object: s,
                            geometry: o,
                            group: l
                        } = r;
                    let c = r.material;
                    !0 === c.allowOverride && null !== i && (c = i), s.layers.test(n.layers) && le(s, e, n, o, c, l)
                }
            }

            function le(t, e, n, i, a, r) {
                t.onBeforeRender(B, e, n, i, a, r), t.modelViewMatrix.multiplyMatrices(n.matrixWorldInverse, t.matrixWorld), t.normalMatrix.getNormalMatrix(t.modelViewMatrix), a.onBeforeRender(B, e, n, i, t, r), !0 === a.transparent && 2 === a.side && !1 === a.forceSinglePass ? (a.side = 1, a.needsUpdate = !0, B.renderBufferDirect(n, e, i, a, t, r), a.side = 0, a.needsUpdate = !0, B.renderBufferDirect(n, e, i, a, t, r), a.side = 2) : B.renderBufferDirect(n, e, i, a, t, r), t.onAfterRender(B, e, n, i, a, r)
            }

            function ce(t, e, n) {
                !0 !== e.isScene && (e = gt);
                const i = St.get(t),
                    a = L.state.lights,
                    r = L.state.shadowsArray,
                    s = a.state.version,
                    o = Lt.getParameters(t, a.state, r, e, n),
                    l = Lt.getProgramCacheKey(o);
                let c = i.programs;
                i.environment = t.isMeshStandardMaterial || t.isMeshLambertMaterial || t.isMeshPhongMaterial ? e.environment : null, i.fog = e.fog;
                const h = t.isMeshStandardMaterial || t.isMeshLambertMaterial && !t.envMap || t.isMeshPhongMaterial && !t.envMap;
                i.envMap = At.get(t.envMap || i.environment, h), i.envMapRotation = null !== i.environment && null === t.envMap ? e.environmentRotation : t.envMapRotation, void 0 === c && (t.addEventListener("dispose", $t), c = new Map, i.programs = c);
                let u = c.get(l);
                if (void 0 !== u) {
                    if (i.currentProgram === u && i.lightsStateVersion === s) return de(t, o), u
                } else o.uniforms = Lt.getUniforms(t), t.onBeforeCompile(o, B), u = Lt.acquireProgram(o, l), c.set(l, u), i.uniforms = o.uniforms;
                const d = i.uniforms;
                return (t.isShaderMaterial || t.isRawShaderMaterial) && !0 !== t.clipping || (d.clippingPlanes = Ot.uniform), de(t, o), i.needsLights = function(t) {
                    return t.isMeshLambertMaterial || t.isMeshToonMaterial || t.isMeshPhongMaterial || t.isMeshStandardMaterial || t.isShadowMaterial || t.isShaderMaterial && !0 === t.lights
                }(t), i.lightsStateVersion = s, i.needsLights && (d.ambientLightColor.value = a.state.ambient, d.lightProbe.value = a.state.probe, d.directionalLights.value = a.state.directional, d.directionalLightShadows.value = a.state.directionalShadow, d.spotLights.value = a.state.spot, d.spotLightShadows.value = a.state.spotShadow, d.rectAreaLights.value = a.state.rectArea, d.ltc_1.value = a.state.rectAreaLTC1, d.ltc_2.value = a.state.rectAreaLTC2, d.pointLights.value = a.state.point, d.pointLightShadows.value = a.state.pointShadow, d.hemisphereLights.value = a.state.hemi, d.directionalShadowMatrix.value = a.state.directionalShadowMatrix, d.spotLightMatrix.value = a.state.spotLightMatrix, d.spotLightMap.value = a.state.spotLightMap, d.pointShadowMatrix.value = a.state.pointShadowMatrix), i.currentProgram = u, i.uniformsList = null, u
            }

            function ue(t) {
                if (null === t.uniformsList) {
                    const e = t.currentProgram.getUniforms();
                    t.uniformsList = es.seqWithValue(e.seq, t.uniforms)
                }
                return t.uniformsList
            }

            function de(t, e) {
                const n = St.get(t);
                n.outputColorSpace = e.outputColorSpace, n.batching = e.batching, n.batchingColor = e.batchingColor, n.instancing = e.instancing, n.instancingColor = e.instancingColor, n.instancingMorph = e.instancingMorph, n.skinning = e.skinning, n.morphTargets = e.morphTargets, n.morphNormals = e.morphNormals, n.morphColors = e.morphColors, n.morphTargetsCount = e.morphTargetsCount, n.numClippingPlanes = e.numClippingPlanes, n.numIntersection = e.numClipIntersection, n.vertexAlphas = e.vertexAlphas, n.vertexTangents = e.vertexTangents, n.toneMapping = e.toneMapping
            }
            ie.setAnimationLoop(function(t) {
                te && te(t)
            }), "undefined" != typeof self && ie.setContext(self), this.setAnimationLoop = function(t) {
                te = t, qt.setAnimationLoop(t), null === t ? ie.stop() : ie.start()
            }, qt.addEventListener("sessionstart", ee), qt.addEventListener("sessionend", ne), this.render = function(t, e) {
                if (void 0 !== e && !0 !== e.isCamera) return void H("WebGLRenderer.render: camera is not an instance of THREE.Camera.");
                if (!0 === V) return;
                const n = !0 === qt.enabled && !0 === qt.isPresenting,
                    i = null !== O && (null === Y || n) && O.begin(B, Y);
                if (!0 === t.matrixWorldAutoUpdate && t.updateMatrixWorld(), null === e.parent && !0 === e.matrixWorldAutoUpdate && e.updateMatrixWorld(), !0 !== qt.enabled || !0 !== qt.isPresenting || null !== O && !1 !== O.isCompositing() || (!0 === qt.cameraAutoUpdate && qt.updateCamera(e), e = qt.getCamera()), !0 === t.isScene && t.onBeforeRender(B, t, e, Y), L = Nt.get(t, U.length), L.init(e), U.push(L), dt.multiplyMatrices(e.projectionMatrix, e.matrixWorldInverse), ct.setFromProjectionMatrix(dt, N, e.reversedDepth), ut = this.localClippingEnabled, ht = Ot.init(this.clippingPlanes, ut), C = Ut.get(t, I.length), C.init(), I.push(C), !0 === qt.enabled && !0 === qt.isPresenting) {
                    const t = B.xr.getDepthSensingMesh();
                    null !== t && ae(t, e, -1 / 0, B.sortObjects)
                }
                ae(t, e, 0, B.sortObjects), C.finish(), !0 === B.sortObjects && C.sort(it, at), _t = !1 === qt.enabled || !1 === qt.isPresenting || !1 === qt.hasDepthSensing(), _t && Bt.addToRenderList(C, t), this.info.render.frame++, !0 === ht && Ot.beginShadows();
                const a = L.state.shadowsArray;
                if (Ft.render(a, t, e), !0 === ht && Ot.endShadows(), !0 === this.info.autoReset && this.info.reset(), !1 === (i && O.hasRenderPass())) {
                    const n = C.opaque,
                        i = C.transmissive;
                    if (L.setupLights(), e.isArrayCamera) {
                        const a = e.cameras;
                        if (i.length > 0)
                            for (let e = 0, r = a.length; e < r; e++) {
                                se(n, i, t, a[e])
                            }
                        _t && Bt.render(t);
                        for (let e = 0, n = a.length; e < n; e++) {
                            const n = a[e];
                            re(C, t, n, n.viewport)
                        }
                    } else i.length > 0 && se(n, i, t, e), _t && Bt.render(t), re(C, t, e)
                }
                null !== Y && 0 === X && (Tt.updateMultisampleRenderTarget(Y), Tt.updateRenderTargetMipmap(Y)), i && O.end(B), !0 === t.isScene && t.onAfterRender(B, t, e), Gt.resetDefaultState(), j = -1, q = null, U.pop(), U.length > 0 ? (L = U[U.length - 1], !0 === ht && Ot.setGlobalState(B.clippingPlanes, L.state.camera)) : L = null, I.pop(), C = I.length > 0 ? I[I.length - 1] : null
            }, this.getActiveCubeFace = function() {
                return W
            }, this.getActiveMipmapLevel = function() {
                return X
            }, this.getRenderTarget = function() {
                return Y
            }, this.setRenderTargetTextures = function(t, e, n) {
                const i = St.get(t);
                i.__autoAllocateDepthBuffer = !1 === t.resolveDepthBuffer, !1 === i.__autoAllocateDepthBuffer && (i.__useRenderToTexture = !1), St.get(t.texture).__webglTexture = e, St.get(t.depthTexture).__webglTexture = i.__autoAllocateDepthBuffer ? void 0 : n, i.__hasExternalTextures = !0
            }, this.setRenderTargetFramebuffer = function(t, e) {
                const n = St.get(t);
                n.__webglFramebuffer = e, n.__useDefaultFramebuffer = void 0 === e
            };
            const pe = Xt.createFramebuffer();
            this.setRenderTarget = function(t, e = 0, n = 0) {
                Y = t, W = e, X = n;
                let i = null,
                    a = !1,
                    r = !1;
                if (t) {
                    const s = St.get(t);
                    if (void 0 !== s.__useDefaultFramebuffer) return bt.bindFramebuffer(Xt.FRAMEBUFFER, s.__webglFramebuffer), Z.copy(t.viewport), K.copy(t.scissor), J = t.scissorTest, bt.viewport(Z), bt.scissor(K), bt.setScissorTest(J), void(j = -1);
                    if (void 0 === s.__webglFramebuffer) Tt.setupRenderTarget(t);
                    else if (s.__hasExternalTextures) Tt.rebindTextures(t, St.get(t.texture).__webglTexture, St.get(t.depthTexture).__webglTexture);
                    else if (t.depthBuffer) {
                        const e = t.depthTexture;
                        if (s.__boundDepthTexture !== e) {
                            if (null !== e && St.has(e) && (t.width !== e.image.width || t.height !== e.image.height)) throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");
                            Tt.setupDepthRenderbuffer(t)
                        }
                    }
                    const o = t.texture;
                    (o.isData3DTexture || o.isDataArrayTexture || o.isCompressedArrayTexture) && (r = !0);
                    const l = St.get(t).__webglFramebuffer;
                    t.isWebGLCubeRenderTarget ? (i = Array.isArray(l[e]) ? l[e][n] : l[e], a = !0) : i = t.samples > 0 && !1 === Tt.useMultisampledRTT(t) ? St.get(t).__webglMultisampledFramebuffer : Array.isArray(l) ? l[n] : l, Z.copy(t.viewport), K.copy(t.scissor), J = t.scissorTest
                } else Z.copy(st).multiplyScalar(nt).floor(), K.copy(ot).multiplyScalar(nt).floor(), J = lt;
                if (0 !== n && (i = pe), bt.bindFramebuffer(Xt.FRAMEBUFFER, i) && bt.drawBuffers(t, i), bt.viewport(Z), bt.scissor(K), bt.setScissorTest(J), a) {
                    const i = St.get(t.texture);
                    Xt.framebufferTexture2D(Xt.FRAMEBUFFER, Xt.COLOR_ATTACHMENT0, Xt.TEXTURE_CUBE_MAP_POSITIVE_X + e, i.__webglTexture, n)
                } else if (r) {
                    const i = e;
                    for (let e = 0; e < t.textures.length; e++) {
                        const a = St.get(t.textures[e]);
                        Xt.framebufferTextureLayer(Xt.FRAMEBUFFER, Xt.COLOR_ATTACHMENT0 + e, a.__webglTexture, n, i)
                    }
                } else if (null !== t && 0 !== n) {
                    const e = St.get(t.texture);
                    Xt.framebufferTexture2D(Xt.FRAMEBUFFER, Xt.COLOR_ATTACHMENT0, Xt.TEXTURE_2D, e.__webglTexture, n)
                }
                j = -1
            }, this.readRenderTargetPixels = function(t, e, n, i, a, r, s, o = 0) {
                if (!t || !t.isWebGLRenderTarget) return void H("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");
                let l = St.get(t).__webglFramebuffer;
                if (t.isWebGLCubeRenderTarget && void 0 !== s && (l = l[s]), l) {
                    bt.bindFramebuffer(Xt.FRAMEBUFFER, l);
                    try {
                        const s = t.textures[o],
                            l = s.format,
                            c = s.type;
                        if (t.textures.length > 1 && Xt.readBuffer(Xt.COLOR_ATTACHMENT0 + o), !Mt.textureFormatReadable(l)) return void H("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");
                        if (!Mt.textureTypeReadable(c)) return void H("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");
                        e >= 0 && e <= t.width - i && n >= 0 && n <= t.height - a && Xt.readPixels(e, n, i, a, Ht.convert(l), Ht.convert(c), r)
                    } finally {
                        const t = null !== Y ? St.get(Y).__webglFramebuffer : null;
                        bt.bindFramebuffer(Xt.FRAMEBUFFER, t)
                    }
                }
            }, this.readRenderTargetPixelsAsync = async function(t, e, n, i, a, r, s, o = 0) {
                if (!t || !t.isWebGLRenderTarget) throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");
                let l = St.get(t).__webglFramebuffer;
                if (t.isWebGLCubeRenderTarget && void 0 !== s && (l = l[s]), l) {
                    if (e >= 0 && e <= t.width - i && n >= 0 && n <= t.height - a) {
                        bt.bindFramebuffer(Xt.FRAMEBUFFER, l);
                        const s = t.textures[o],
                            c = s.format,
                            h = s.type;
                        if (t.textures.length > 1 && Xt.readBuffer(Xt.COLOR_ATTACHMENT0 + o), !Mt.textureFormatReadable(c)) throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");
                        if (!Mt.textureTypeReadable(h)) throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");
                        const u = Xt.createBuffer();
                        Xt.bindBuffer(Xt.PIXEL_PACK_BUFFER, u), Xt.bufferData(Xt.PIXEL_PACK_BUFFER, r.byteLength, Xt.STREAM_READ), Xt.readPixels(e, n, i, a, Ht.convert(c), Ht.convert(h), 0);
                        const d = null !== Y ? St.get(Y).__webglFramebuffer : null;
                        bt.bindFramebuffer(Xt.FRAMEBUFFER, d);
                        const p = Xt.fenceSync(Xt.SYNC_GPU_COMMANDS_COMPLETE, 0);
                        return Xt.flush(), await
                        function(t, e, n) {
                            return new Promise(function(i, a) {
                                setTimeout(function r() {
                                    switch (t.clientWaitSync(e, t.SYNC_FLUSH_COMMANDS_BIT, 0)) {
                                        case t.WAIT_FAILED:
                                            a();
                                            break;
                                        case t.TIMEOUT_EXPIRED:
                                            setTimeout(r, n);
                                            break;
                                        default:
                                            i()
                                    }
                                }, n)
                            })
                        }(Xt, p, 4), Xt.bindBuffer(Xt.PIXEL_PACK_BUFFER, u), Xt.getBufferSubData(Xt.PIXEL_PACK_BUFFER, 0, r), Xt.deleteBuffer(u), Xt.deleteSync(p), r
                    }
                    throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")
                }
            }, this.copyFramebufferToTexture = function(t, e = null, n = 0) {
                const i = Math.pow(2, -n),
                    a = Math.floor(t.image.width * i),
                    r = Math.floor(t.image.height * i),
                    s = null !== e ? e.x : 0,
                    o = null !== e ? e.y : 0;
                Tt.setTexture2D(t, 0), Xt.copyTexSubImage2D(Xt.TEXTURE_2D, n, 0, 0, s, o, a, r), bt.unbindTexture()
            };
            const me = Xt.createFramebuffer(),
                fe = Xt.createFramebuffer();
            this.copyTextureToTexture = function(t, e, n = null, i = null, a = 0, r = 0) {
                let s, o, l, c, h, u, d, p, m;
                const f = t.isCompressedTexture ? t.mipmaps[r] : t.image;
                if (null !== n) s = n.max.x - n.min.x, o = n.max.y - n.min.y, l = n.isBox3 ? n.max.z - n.min.z : 1, c = n.min.x, h = n.min.y, u = n.isBox3 ? n.min.z : 0;
                else {
                    const e = Math.pow(2, -a);
                    s = Math.floor(f.width * e), o = Math.floor(f.height * e), l = t.isDataArrayTexture ? f.depth : t.isData3DTexture ? Math.floor(f.depth * e) : 1, c = 0, h = 0, u = 0
                }
                null !== i ? (d = i.x, p = i.y, m = i.z) : (d = 0, p = 0, m = 0);
                const g = Ht.convert(e.format),
                    _ = Ht.convert(e.type);
                let v;
                e.isData3DTexture ? (Tt.setTexture3D(e, 0), v = Xt.TEXTURE_3D) : e.isDataArrayTexture || e.isCompressedArrayTexture ? (Tt.setTexture2DArray(e, 0), v = Xt.TEXTURE_2D_ARRAY) : (Tt.setTexture2D(e, 0), v = Xt.TEXTURE_2D), Xt.pixelStorei(Xt.UNPACK_FLIP_Y_WEBGL, e.flipY), Xt.pixelStorei(Xt.UNPACK_PREMULTIPLY_ALPHA_WEBGL, e.premultiplyAlpha), Xt.pixelStorei(Xt.UNPACK_ALIGNMENT, e.unpackAlignment);
                const x = Xt.getParameter(Xt.UNPACK_ROW_LENGTH),
                    M = Xt.getParameter(Xt.UNPACK_IMAGE_HEIGHT),
                    b = Xt.getParameter(Xt.UNPACK_SKIP_PIXELS),
                    y = Xt.getParameter(Xt.UNPACK_SKIP_ROWS),
                    S = Xt.getParameter(Xt.UNPACK_SKIP_IMAGES);
                Xt.pixelStorei(Xt.UNPACK_ROW_LENGTH, f.width), Xt.pixelStorei(Xt.UNPACK_IMAGE_HEIGHT, f.height), Xt.pixelStorei(Xt.UNPACK_SKIP_PIXELS, c), Xt.pixelStorei(Xt.UNPACK_SKIP_ROWS, h), Xt.pixelStorei(Xt.UNPACK_SKIP_IMAGES, u);
                const E = t.isDataArrayTexture || t.isData3DTexture,
                    T = e.isDataArrayTexture || e.isData3DTexture;
                if (t.isDepthTexture) {
                    const n = St.get(t),
                        i = St.get(e),
                        f = St.get(n.__renderTarget),
                        g = St.get(i.__renderTarget);
                    bt.bindFramebuffer(Xt.READ_FRAMEBUFFER, f.__webglFramebuffer), bt.bindFramebuffer(Xt.DRAW_FRAMEBUFFER, g.__webglFramebuffer);
                    for (let _ = 0; _ < l; _++) E && (Xt.framebufferTextureLayer(Xt.READ_FRAMEBUFFER, Xt.COLOR_ATTACHMENT0, St.get(t).__webglTexture, a, u + _), Xt.framebufferTextureLayer(Xt.DRAW_FRAMEBUFFER, Xt.COLOR_ATTACHMENT0, St.get(e).__webglTexture, r, m + _)), Xt.blitFramebuffer(c, h, s, o, d, p, s, o, Xt.DEPTH_BUFFER_BIT, Xt.NEAREST);
                    bt.bindFramebuffer(Xt.READ_FRAMEBUFFER, null), bt.bindFramebuffer(Xt.DRAW_FRAMEBUFFER, null)
                } else if (0 !== a || t.isRenderTargetTexture || St.has(t)) {
                    const n = St.get(t),
                        i = St.get(e);
                    bt.bindFramebuffer(Xt.READ_FRAMEBUFFER, me), bt.bindFramebuffer(Xt.DRAW_FRAMEBUFFER, fe);
                    for (let t = 0; t < l; t++) E ? Xt.framebufferTextureLayer(Xt.READ_FRAMEBUFFER, Xt.COLOR_ATTACHMENT0, n.__webglTexture, a, u + t) : Xt.framebufferTexture2D(Xt.READ_FRAMEBUFFER, Xt.COLOR_ATTACHMENT0, Xt.TEXTURE_2D, n.__webglTexture, a), T ? Xt.framebufferTextureLayer(Xt.DRAW_FRAMEBUFFER, Xt.COLOR_ATTACHMENT0, i.__webglTexture, r, m + t) : Xt.framebufferTexture2D(Xt.DRAW_FRAMEBUFFER, Xt.COLOR_ATTACHMENT0, Xt.TEXTURE_2D, i.__webglTexture, r), 0 !== a ? Xt.blitFramebuffer(c, h, s, o, d, p, s, o, Xt.COLOR_BUFFER_BIT, Xt.NEAREST) : T ? Xt.copyTexSubImage3D(v, r, d, p, m + t, c, h, s, o) : Xt.copyTexSubImage2D(v, r, d, p, c, h, s, o);
                    bt.bindFramebuffer(Xt.READ_FRAMEBUFFER, null), bt.bindFramebuffer(Xt.DRAW_FRAMEBUFFER, null)
                } else T ? t.isDataTexture || t.isData3DTexture ? Xt.texSubImage3D(v, r, d, p, m, s, o, l, g, _, f.data) : e.isCompressedArrayTexture ? Xt.compressedTexSubImage3D(v, r, d, p, m, s, o, l, g, f.data) : Xt.texSubImage3D(v, r, d, p, m, s, o, l, g, _, f) : t.isDataTexture ? Xt.texSubImage2D(Xt.TEXTURE_2D, r, d, p, s, o, g, _, f.data) : t.isCompressedTexture ? Xt.compressedTexSubImage2D(Xt.TEXTURE_2D, r, d, p, f.width, f.height, g, f.data) : Xt.texSubImage2D(Xt.TEXTURE_2D, r, d, p, s, o, g, _, f);
                Xt.pixelStorei(Xt.UNPACK_ROW_LENGTH, x), Xt.pixelStorei(Xt.UNPACK_IMAGE_HEIGHT, M), Xt.pixelStorei(Xt.UNPACK_SKIP_PIXELS, b), Xt.pixelStorei(Xt.UNPACK_SKIP_ROWS, y), Xt.pixelStorei(Xt.UNPACK_SKIP_IMAGES, S), 0 === r && e.generateMipmaps && Xt.generateMipmap(v), bt.unbindTexture()
            }, this.initRenderTarget = function(t) {
                void 0 === St.get(t).__webglFramebuffer && Tt.setupRenderTarget(t)
            }, this.initTexture = function(t) {
                t.isCubeTexture ? Tt.setTextureCube(t, 0) : t.isData3DTexture ? Tt.setTexture3D(t, 0) : t.isDataArrayTexture || t.isCompressedArrayTexture ? Tt.setTexture2DArray(t, 0) : Tt.setTexture2D(t, 0), bt.unbindTexture()
            }, this.resetState = function() {
                W = 0, X = 0, Y = null, bt.reset(), Gt.reset()
            }, "undefined" != typeof __THREE_DEVTOOLS__ && __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe", {
                detail: this
            }))
        }
        get coordinateSystem() {
            return N
        }
        get outputColorSpace() {
            return this._outputColorSpace
        }
        set outputColorSpace(t) {
            this._outputColorSpace = t;
            const e = this.getContext();
            e.drawingBufferColorSpace = mt._getDrawingBufferColorSpace(t), e.unpackColorSpace = mt._getUnpackColorSpace()
        }
    },
    ro = {
        type: "change"
    },
    so = {
        type: "start"
    },
    oo = {
        type: "end"
    },
    lo = new On,
    co = new ei,
    ho = Math.cos(70 * nt.DEG2RAD),
    uo = new rt,
    po = 2 * Math.PI,
    mo = -1,
    fo = 0,
    go = 1,
    _o = 2,
    vo = 3,
    xo = 4,
    Mo = 5,
    bo = 6,
    yo = 1e-6,
    So = class extends ua {
        constructor(t, r = null) {
            super(t, r), this.state = mo, this.target = new rt, this.cursor = new rt, this.minDistance = 0, this.maxDistance = 1 / 0, this.minZoom = 0, this.maxZoom = 1 / 0, this.minTargetRadius = 0, this.maxTargetRadius = 1 / 0, this.minPolarAngle = 0, this.maxPolarAngle = Math.PI, this.minAzimuthAngle = -1 / 0, this.maxAzimuthAngle = 1 / 0, this.enableDamping = !1, this.dampingFactor = .05, this.enableZoom = !0, this.zoomSpeed = 1, this.enableRotate = !0, this.rotateSpeed = 1, this.keyRotateSpeed = 1, this.enablePan = !0, this.panSpeed = 1, this.screenSpacePanning = !0, this.keyPanSpeed = 7, this.zoomToCursor = !1, this.autoRotate = !1, this.autoRotateSpeed = 2, this.keys = {
                LEFT: "ArrowLeft",
                UP: "ArrowUp",
                RIGHT: "ArrowRight",
                BOTTOM: "ArrowDown"
            }, this.mouseButtons = {
                LEFT: e,
                MIDDLE: n,
                RIGHT: i
            }, this.touches = {
                ONE: a,
                TWO: s
            }, this.target0 = this.target.clone(), this.position0 = this.object.position.clone(), this.zoom0 = this.object.zoom, this._cursorStyle = "auto", this._domElementKeyEvents = null, this._lastPosition = new rt, this._lastQuaternion = new at, this._lastTargetPosition = new rt, this._quat = (new at).setFromUnitVectors(t.up, new rt(0, 1, 0)), this._quatInverse = this._quat.clone().invert(), this._spherical = new ha, this._sphericalDelta = new ha, this._scale = 1, this._panOffset = new rt, this._rotateStart = new it, this._rotateEnd = new it, this._rotateDelta = new it, this._panStart = new it, this._panEnd = new it, this._panDelta = new it, this._dollyStart = new it, this._dollyEnd = new it, this._dollyDelta = new it, this._dollyDirection = new rt, this._mouse = new it, this._performCursorZoom = !1, this._pointers = [], this._pointerPositions = {}, this._controlActive = !1, this._onPointerMove = To.bind(this), this._onPointerDown = Eo.bind(this), this._onPointerUp = wo.bind(this), this._onContextMenu = Io.bind(this), this._onMouseWheel = Co.bind(this), this._onKeyDown = Po.bind(this), this._onTouchStart = Do.bind(this), this._onTouchMove = Lo.bind(this), this._onMouseDown = Ao.bind(this), this._onMouseMove = Ro.bind(this), this._interceptControlDown = Uo.bind(this), this._interceptControlUp = No.bind(this), null !== this.domElement && this.connect(this.domElement), this.update()
        }
        set cursorStyle(t) {
            this._cursorStyle = t, this.domElement.style.cursor = "grab" === t ? "grab" : "auto"
        }
        get cursorStyle() {
            return this._cursorStyle
        }
        connect(t) {
            super.connect(t), this.domElement.addEventListener("pointerdown", this._onPointerDown), this.domElement.addEventListener("pointercancel", this._onPointerUp), this.domElement.addEventListener("contextmenu", this._onContextMenu), this.domElement.addEventListener("wheel", this._onMouseWheel, {
                passive: !1
            }), this.domElement.getRootNode().addEventListener("keydown", this._interceptControlDown, {
                passive: !0,
                capture: !0
            }), this.domElement.style.touchAction = "none"
        }
        disconnect() {
            this.domElement.removeEventListener("pointerdown", this._onPointerDown), this.domElement.ownerDocument.removeEventListener("pointermove", this._onPointerMove), this.domElement.ownerDocument.removeEventListener("pointerup", this._onPointerUp), this.domElement.removeEventListener("pointercancel", this._onPointerUp), this.domElement.removeEventListener("wheel", this._onMouseWheel), this.domElement.removeEventListener("contextmenu", this._onContextMenu), this.stopListenToKeyEvents(), this.domElement.getRootNode().removeEventListener("keydown", this._interceptControlDown, {
                capture: !0
            }), this.domElement.style.touchAction = "auto"
        }
        dispose() {
            this.disconnect()
        }
        getPolarAngle() {
            return this._spherical.phi
        }
        getAzimuthalAngle() {
            return this._spherical.theta
        }
        getDistance() {
            return this.object.position.distanceTo(this.target)
        }
        listenToKeyEvents(t) {
            t.addEventListener("keydown", this._onKeyDown), this._domElementKeyEvents = t
        }
        stopListenToKeyEvents() {
            null !== this._domElementKeyEvents && (this._domElementKeyEvents.removeEventListener("keydown", this._onKeyDown), this._domElementKeyEvents = null)
        }
        saveState() {
            this.target0.copy(this.target), this.position0.copy(this.object.position), this.zoom0 = this.object.zoom
        }
        reset() {
            this.target.copy(this.target0), this.object.position.copy(this.position0), this.object.zoom = this.zoom0, this.object.updateProjectionMatrix(), this.dispatchEvent(ro), this.update(), this.state = mo
        }
        pan(t, e) {
            this._pan(t, e), this.update()
        }
        dollyIn(t) {
            this._dollyIn(t), this.update()
        }
        dollyOut(t) {
            this._dollyOut(t), this.update()
        }
        rotateLeft(t) {
            this._rotateLeft(t), this.update()
        }
        rotateUp(t) {
            this._rotateUp(t), this.update()
        }
        update(t = null) {
            const e = this.object.position;
            uo.copy(e).sub(this.target), uo.applyQuaternion(this._quat), this._spherical.setFromVector3(uo), this.autoRotate && this.state === mo && this._rotateLeft(this._getAutoRotationAngle(t)), this.enableDamping ? (this._spherical.theta += this._sphericalDelta.theta * this.dampingFactor, this._spherical.phi += this._sphericalDelta.phi * this.dampingFactor) : (this._spherical.theta += this._sphericalDelta.theta, this._spherical.phi += this._sphericalDelta.phi);
            let n = this.minAzimuthAngle,
                i = this.maxAzimuthAngle;
            isFinite(n) && isFinite(i) && (n < -Math.PI ? n += po : n > Math.PI && (n -= po), i < -Math.PI ? i += po : i > Math.PI && (i -= po), this._spherical.theta = n <= i ? Math.max(n, Math.min(i, this._spherical.theta)) : this._spherical.theta > (n + i) / 2 ? Math.max(n, this._spherical.theta) : Math.min(i, this._spherical.theta)), this._spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._spherical.phi)), this._spherical.makeSafe(), !0 === this.enableDamping ? this.target.addScaledVector(this._panOffset, this.dampingFactor) : this.target.add(this._panOffset), this.target.sub(this.cursor), this.target.clampLength(this.minTargetRadius, this.maxTargetRadius), this.target.add(this.cursor);
            let a = !1;
            if (this.zoomToCursor && this._performCursorZoom || this.object.isOrthographicCamera) this._spherical.radius = this._clampDistance(this._spherical.radius);
            else {
                const t = this._spherical.radius;
                this._spherical.radius = this._clampDistance(this._spherical.radius * this._scale), a = t != this._spherical.radius
            }
            if (uo.setFromSpherical(this._spherical), uo.applyQuaternion(this._quatInverse), e.copy(this.target).add(uo), this.object.lookAt(this.target), !0 === this.enableDamping ? (this._sphericalDelta.theta *= 1 - this.dampingFactor, this._sphericalDelta.phi *= 1 - this.dampingFactor, this._panOffset.multiplyScalar(1 - this.dampingFactor)) : (this._sphericalDelta.set(0, 0, 0), this._panOffset.set(0, 0, 0)), this.zoomToCursor && this._performCursorZoom) {
                let t = null;
                if (this.object.isPerspectiveCamera) {
                    const e = uo.length();
                    t = this._clampDistance(e * this._scale);
                    const n = e - t;
                    this.object.position.addScaledVector(this._dollyDirection, n), this.object.updateMatrixWorld(), a = !!n
                } else if (this.object.isOrthographicCamera) {
                    const e = new rt(this._mouse.x, this._mouse.y, 0);
                    e.unproject(this.object);
                    const n = this.object.zoom;
                    this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom / this._scale)), this.object.updateProjectionMatrix(), a = n !== this.object.zoom;
                    const i = new rt(this._mouse.x, this._mouse.y, 0);
                    i.unproject(this.object), this.object.position.sub(i).add(e), this.object.updateMatrixWorld(), t = uo.length()
                } else this.zoomToCursor = !1;
                null !== t && (this.screenSpacePanning ? this.target.set(0, 0, -1).transformDirection(this.object.matrix).multiplyScalar(t).add(this.object.position) : (lo.origin.copy(this.object.position), lo.direction.set(0, 0, -1).transformDirection(this.object.matrix), Math.abs(this.object.up.dot(lo.direction)) < ho ? this.object.lookAt(this.target) : (co.setFromNormalAndCoplanarPoint(this.object.up, this.target), lo.intersectPlane(co, this.target))))
            } else if (this.object.isOrthographicCamera) {
                const t = this.object.zoom;
                this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom / this._scale)), t !== this.object.zoom && (this.object.updateProjectionMatrix(), a = !0)
            }
            return this._scale = 1, this._performCursorZoom = !1, !!(a || this._lastPosition.distanceToSquared(this.object.position) > yo || 8 * (1 - this._lastQuaternion.dot(this.object.quaternion)) > yo || this._lastTargetPosition.distanceToSquared(this.target) > yo) && (this.dispatchEvent(ro), this._lastPosition.copy(this.object.position), this._lastQuaternion.copy(this.object.quaternion), this._lastTargetPosition.copy(this.target), !0)
        }
        _getAutoRotationAngle(t) {
            return null !== t ? po / 60 * this.autoRotateSpeed * t : po / 60 / 60 * this.autoRotateSpeed
        }
        _getZoomScale(t) {
            const e = Math.abs(.01 * t);
            return Math.pow(.95, this.zoomSpeed * e)
        }
        _rotateLeft(t) {
            this._sphericalDelta.theta -= t
        }
        _rotateUp(t) {
            this._sphericalDelta.phi -= t
        }
        _panLeft(t, e) {
            uo.setFromMatrixColumn(e, 0), uo.multiplyScalar(-t), this._panOffset.add(uo)
        }
        _panUp(t, e) {
            !0 === this.screenSpacePanning ? uo.setFromMatrixColumn(e, 1) : (uo.setFromMatrixColumn(e, 0), uo.crossVectors(this.object.up, uo)), uo.multiplyScalar(t), this._panOffset.add(uo)
        }
        _pan(t, e) {
            const n = this.domElement;
            if (this.object.isPerspectiveCamera) {
                const i = this.object.position;
                uo.copy(i).sub(this.target);
                let a = uo.length();
                a *= Math.tan(this.object.fov / 2 * Math.PI / 180), this._panLeft(2 * t * a / n.clientHeight, this.object.matrix), this._panUp(2 * e * a / n.clientHeight, this.object.matrix)
            } else this.object.isOrthographicCamera ? (this._panLeft(t * (this.object.right - this.object.left) / this.object.zoom / n.clientWidth, this.object.matrix), this._panUp(e * (this.object.top - this.object.bottom) / this.object.zoom / n.clientHeight, this.object.matrix)) : this.enablePan = !1
        }
        _dollyOut(t) {
            this.object.isPerspectiveCamera || this.object.isOrthographicCamera ? this._scale /= t : this.enableZoom = !1
        }
        _dollyIn(t) {
            this.object.isPerspectiveCamera || this.object.isOrthographicCamera ? this._scale *= t : this.enableZoom = !1
        }
        _updateZoomParameters(t, e) {
            if (!this.zoomToCursor) return;
            this._performCursorZoom = !0;
            const n = this.domElement.getBoundingClientRect(),
                i = t - n.left,
                a = e - n.top,
                r = n.width,
                s = n.height;
            this._mouse.x = i / r * 2 - 1, this._mouse.y = -a / s * 2 + 1, this._dollyDirection.set(this._mouse.x, this._mouse.y, 1).unproject(this.object).sub(this.object.position).normalize()
        }
        _clampDistance(t) {
            return Math.max(this.minDistance, Math.min(this.maxDistance, t))
        }
        _handleMouseDownRotate(t) {
            this._rotateStart.set(t.clientX, t.clientY)
        }
        _handleMouseDownDolly(t) {
            this._updateZoomParameters(t.clientX, t.clientX), this._dollyStart.set(t.clientX, t.clientY)
        }
        _handleMouseDownPan(t) {
            this._panStart.set(t.clientX, t.clientY)
        }
        _handleMouseMoveRotate(t) {
            this._rotateEnd.set(t.clientX, t.clientY), this._rotateDelta.subVectors(this._rotateEnd, this._rotateStart).multiplyScalar(this.rotateSpeed);
            const e = this.domElement;
            this._rotateLeft(po * this._rotateDelta.x / e.clientHeight), this._rotateUp(po * this._rotateDelta.y / e.clientHeight), this._rotateStart.copy(this._rotateEnd), this.update()
        }
        _handleMouseMoveDolly(t) {
            this._dollyEnd.set(t.clientX, t.clientY), this._dollyDelta.subVectors(this._dollyEnd, this._dollyStart), this._dollyDelta.y > 0 ? this._dollyOut(this._getZoomScale(this._dollyDelta.y)) : this._dollyDelta.y < 0 && this._dollyIn(this._getZoomScale(this._dollyDelta.y)), this._dollyStart.copy(this._dollyEnd), this.update()
        }
        _handleMouseMovePan(t) {
            this._panEnd.set(t.clientX, t.clientY), this._panDelta.subVectors(this._panEnd, this._panStart).multiplyScalar(this.panSpeed), this._pan(this._panDelta.x, this._panDelta.y), this._panStart.copy(this._panEnd), this.update()
        }
        _handleMouseWheel(t) {
            this._updateZoomParameters(t.clientX, t.clientY), t.deltaY < 0 ? this._dollyIn(this._getZoomScale(t.deltaY)) : t.deltaY > 0 && this._dollyOut(this._getZoomScale(t.deltaY)), this.update()
        }
        _handleKeyDown(t) {
            let e = !1;
            switch (t.code) {
                case this.keys.UP:
                    t.ctrlKey || t.metaKey || t.shiftKey ? this.enableRotate && this._rotateUp(po * this.keyRotateSpeed / this.domElement.clientHeight) : this.enablePan && this._pan(0, this.keyPanSpeed), e = !0;
                    break;
                case this.keys.BOTTOM:
                    t.ctrlKey || t.metaKey || t.shiftKey ? this.enableRotate && this._rotateUp(-po * this.keyRotateSpeed / this.domElement.clientHeight) : this.enablePan && this._pan(0, -this.keyPanSpeed), e = !0;
                    break;
                case this.keys.LEFT:
                    t.ctrlKey || t.metaKey || t.shiftKey ? this.enableRotate && this._rotateLeft(po * this.keyRotateSpeed / this.domElement.clientHeight) : this.enablePan && this._pan(this.keyPanSpeed, 0), e = !0;
                    break;
                case this.keys.RIGHT:
                    t.ctrlKey || t.metaKey || t.shiftKey ? this.enableRotate && this._rotateLeft(-po * this.keyRotateSpeed / this.domElement.clientHeight) : this.enablePan && this._pan(-this.keyPanSpeed, 0), e = !0
            }
            e && (t.preventDefault(), this.update())
        }
        _handleTouchStartRotate(t) {
            if (1 === this._pointers.length) this._rotateStart.set(t.pageX, t.pageY);
            else {
                const e = this._getSecondPointerPosition(t),
                    n = .5 * (t.pageX + e.x),
                    i = .5 * (t.pageY + e.y);
                this._rotateStart.set(n, i)
            }
        }
        _handleTouchStartPan(t) {
            if (1 === this._pointers.length) this._panStart.set(t.pageX, t.pageY);
            else {
                const e = this._getSecondPointerPosition(t),
                    n = .5 * (t.pageX + e.x),
                    i = .5 * (t.pageY + e.y);
                this._panStart.set(n, i)
            }
        }
        _handleTouchStartDolly(t) {
            const e = this._getSecondPointerPosition(t),
                n = t.pageX - e.x,
                i = t.pageY - e.y,
                a = Math.sqrt(n * n + i * i);
            this._dollyStart.set(0, a)
        }
        _handleTouchStartDollyPan(t) {
            this.enableZoom && this._handleTouchStartDolly(t), this.enablePan && this._handleTouchStartPan(t)
        }
        _handleTouchStartDollyRotate(t) {
            this.enableZoom && this._handleTouchStartDolly(t), this.enableRotate && this._handleTouchStartRotate(t)
        }
        _handleTouchMoveRotate(t) {
            if (1 == this._pointers.length) this._rotateEnd.set(t.pageX, t.pageY);
            else {
                const e = this._getSecondPointerPosition(t),
                    n = .5 * (t.pageX + e.x),
                    i = .5 * (t.pageY + e.y);
                this._rotateEnd.set(n, i)
            }
            this._rotateDelta.subVectors(this._rotateEnd, this._rotateStart).multiplyScalar(this.rotateSpeed);
            const e = this.domElement;
            this._rotateLeft(po * this._rotateDelta.x / e.clientHeight), this._rotateUp(po * this._rotateDelta.y / e.clientHeight), this._rotateStart.copy(this._rotateEnd)
        }
        _handleTouchMovePan(t) {
            if (1 === this._pointers.length) this._panEnd.set(t.pageX, t.pageY);
            else {
                const e = this._getSecondPointerPosition(t),
                    n = .5 * (t.pageX + e.x),
                    i = .5 * (t.pageY + e.y);
                this._panEnd.set(n, i)
            }
            this._panDelta.subVectors(this._panEnd, this._panStart).multiplyScalar(this.panSpeed), this._pan(this._panDelta.x, this._panDelta.y), this._panStart.copy(this._panEnd)
        }
        _handleTouchMoveDolly(t) {
            const e = this._getSecondPointerPosition(t),
                n = t.pageX - e.x,
                i = t.pageY - e.y,
                a = Math.sqrt(n * n + i * i);
            this._dollyEnd.set(0, a), this._dollyDelta.set(0, Math.pow(this._dollyEnd.y / this._dollyStart.y, this.zoomSpeed)), this._dollyOut(this._dollyDelta.y), this._dollyStart.copy(this._dollyEnd);
            const r = .5 * (t.pageX + e.x),
                s = .5 * (t.pageY + e.y);
            this._updateZoomParameters(r, s)
        }
        _handleTouchMoveDollyPan(t) {
            this.enableZoom && this._handleTouchMoveDolly(t), this.enablePan && this._handleTouchMovePan(t)
        }
        _handleTouchMoveDollyRotate(t) {
            this.enableZoom && this._handleTouchMoveDolly(t), this.enableRotate && this._handleTouchMoveRotate(t)
        }
        _addPointer(t) {
            this._pointers.push(t.pointerId)
        }
        _removePointer(t) {
            delete this._pointerPositions[t.pointerId];
            for (let e = 0; e < this._pointers.length; e++)
                if (this._pointers[e] == t.pointerId) return void this._pointers.splice(e, 1)
        }
        _isTrackingPointer(t) {
            for (let e = 0; e < this._pointers.length; e++)
                if (this._pointers[e] == t.pointerId) return !0;
            return !1
        }
        _trackPointer(t) {
            let e = this._pointerPositions[t.pointerId];
            void 0 === e && (e = new it, this._pointerPositions[t.pointerId] = e), e.set(t.pageX, t.pageY)
        }
        _getSecondPointerPosition(t) {
            const e = t.pointerId === this._pointers[0] ? this._pointers[1] : this._pointers[0];
            return this._pointerPositions[e]
        }
        _customWheelEvent(t) {
            const e = t.deltaMode,
                n = {
                    clientX: t.clientX,
                    clientY: t.clientY,
                    deltaY: t.deltaY
                };
            switch (e) {
                case 1:
                    n.deltaY *= 16;
                    break;
                case 2:
                    n.deltaY *= 100
            }
            return t.ctrlKey && !this._controlActive && (n.deltaY *= 10), n
        }
    };

function Eo(t) {
    !1 !== this.enabled && (0 === this._pointers.length && (this.domElement.setPointerCapture(t.pointerId), this.domElement.ownerDocument.addEventListener("pointermove", this._onPointerMove), this.domElement.ownerDocument.addEventListener("pointerup", this._onPointerUp)), this._isTrackingPointer(t) || (this._addPointer(t), "touch" === t.pointerType ? this._onTouchStart(t) : this._onMouseDown(t), "grab" === this._cursorStyle && (this.domElement.style.cursor = "grabbing")))
}

function To(t) {
    !1 !== this.enabled && ("touch" === t.pointerType ? this._onTouchMove(t) : this._onMouseMove(t))
}

function wo(t) {
    switch (this._removePointer(t), this._pointers.length) {
        case 0:
            this.domElement.releasePointerCapture(t.pointerId), this.domElement.ownerDocument.removeEventListener("pointermove", this._onPointerMove), this.domElement.ownerDocument.removeEventListener("pointerup", this._onPointerUp), this.dispatchEvent(oo), this.state = mo, "grab" === this._cursorStyle && (this.domElement.style.cursor = "grab");
            break;
        case 1:
            const e = this._pointers[0],
                n = this._pointerPositions[e];
            this._onTouchStart({
                pointerId: e,
                pageX: n.x,
                pageY: n.y
            })
    }
}

function Ao(t) {
    let a;
    switch (t.button) {
        case 0:
            a = this.mouseButtons.LEFT;
            break;
        case 1:
            a = this.mouseButtons.MIDDLE;
            break;
        case 2:
            a = this.mouseButtons.RIGHT;
            break;
        default:
            a = -1
    }
    switch (a) {
        case n:
            if (!1 === this.enableZoom) return;
            this._handleMouseDownDolly(t), this.state = go;
            break;
        case e:
            if (t.ctrlKey || t.metaKey || t.shiftKey) {
                if (!1 === this.enablePan) return;
                this._handleMouseDownPan(t), this.state = _o
            } else {
                if (!1 === this.enableRotate) return;
                this._handleMouseDownRotate(t), this.state = fo
            }
            break;
        case i:
            if (t.ctrlKey || t.metaKey || t.shiftKey) {
                if (!1 === this.enableRotate) return;
                this._handleMouseDownRotate(t), this.state = fo
            } else {
                if (!1 === this.enablePan) return;
                this._handleMouseDownPan(t), this.state = _o
            }
            break;
        default:
            this.state = mo
    }
    this.state !== mo && this.dispatchEvent(so)
}

function Ro(t) {
    switch (this.state) {
        case fo:
            if (!1 === this.enableRotate) return;
            this._handleMouseMoveRotate(t);
            break;
        case go:
            if (!1 === this.enableZoom) return;
            this._handleMouseMoveDolly(t);
            break;
        case _o:
            if (!1 === this.enablePan) return;
            this._handleMouseMovePan(t)
    }
}

function Co(t) {
    !1 !== this.enabled && !1 !== this.enableZoom && this.state === mo && (t.preventDefault(), this.dispatchEvent(so), this._handleMouseWheel(this._customWheelEvent(t)), this.dispatchEvent(oo))
}

function Po(t) {
    !1 !== this.enabled && this._handleKeyDown(t)
}

function Do(t) {
    switch (this._trackPointer(t), this._pointers.length) {
        case 1:
            switch (this.touches.ONE) {
                case a:
                    if (!1 === this.enableRotate) return;
                    this._handleTouchStartRotate(t), this.state = vo;
                    break;
                case r:
                    if (!1 === this.enablePan) return;
                    this._handleTouchStartPan(t), this.state = xo;
                    break;
                default:
                    this.state = mo
            }
            break;
        case 2:
            switch (this.touches.TWO) {
                case s:
                    if (!1 === this.enableZoom && !1 === this.enablePan) return;
                    this._handleTouchStartDollyPan(t), this.state = Mo;
                    break;
                case o:
                    if (!1 === this.enableZoom && !1 === this.enableRotate) return;
                    this._handleTouchStartDollyRotate(t), this.state = bo;
                    break;
                default:
                    this.state = mo
            }
            break;
        default:
            this.state = mo
    }
    this.state !== mo && this.dispatchEvent(so)
}

function Lo(t) {
    switch (this._trackPointer(t), this.state) {
        case vo:
            if (!1 === this.enableRotate) return;
            this._handleTouchMoveRotate(t), this.update();
            break;
        case xo:
            if (!1 === this.enablePan) return;
            this._handleTouchMovePan(t), this.update();
            break;
        case Mo:
            if (!1 === this.enableZoom && !1 === this.enablePan) return;
            this._handleTouchMoveDollyPan(t), this.update();
            break;
        case bo:
            if (!1 === this.enableZoom && !1 === this.enableRotate) return;
            this._handleTouchMoveDollyRotate(t), this.update();
            break;
        default:
            this.state = mo
    }
}

function Io(t) {
    !1 !== this.enabled && t.preventDefault()
}

function Uo(t) {
    "Control" === t.key && (this._controlActive = !0, this.domElement.getRootNode().addEventListener("keyup", this._interceptControlUp, {
        passive: !0,
        capture: !0
    }))
}

function No(t) {
    "Control" === t.key && (this._controlActive = !1, this.domElement.getRootNode().removeEventListener("keyup", this._interceptControlUp, {
        passive: !0,
        capture: !0
    }))
}
var Oo, Fo = new ei,
    Bo = new oa,
    zo = new it,
    Vo = new rt,
    ko = class extends So {
        constructor(t, a) {
            super(t, a), this.screenSpacePanning = !1, this.mouseButtons = {
                LEFT: i,
                MIDDLE: n,
                RIGHT: e
            }, this.touches = {
                ONE: r,
                TWO: o
            }, this._panWorldStart = new rt
        }
        _handleMouseDownPan(t) {
            if (super._handleMouseDownPan(t), this._panOffset.set(0, 0, 0), !0 === this.screenSpacePanning) return;
            Fo.setFromNormalAndCoplanarPoint(this.object.up, this.target);
            const e = this.domElement.getBoundingClientRect();
            zo.x = (t.clientX - e.left) / e.width * 2 - 1, zo.y = -(t.clientY - e.top) / e.height * 2 + 1, Bo.setFromCamera(zo, this.object), Bo.ray.intersectPlane(Fo, this._panWorldStart)
        }
        _handleMouseMovePan(t) {
            if (!0 === this.screenSpacePanning) return void super._handleMouseMovePan(t);
            const e = this.domElement.getBoundingClientRect();
            zo.x = (t.clientX - e.left) / e.width * 2 - 1, zo.y = -(t.clientY - e.top) / e.height * 2 + 1, Bo.setFromCamera(zo, this.object), Bo.ray.intersectPlane(Fo, Vo) && (Vo.sub(this._panWorldStart), this._panOffset.copy(Vo).negate(), this.update())
        }
    },
    Ho = class t {
        static INTRO_LABEL_DELAY_OFFSET = 200;
        static INTRO_LABEL_DURATION = 500;
        constructor(t) {
            this.group = t, this.voxels = [], this.focusedYearOffset = null, this.focusedMonth = null, this.numYears = 0, this.animationStartTime = 0, this.maxDelay = 0, this.labelsAnimated = !1;
            const e = getComputedStyle(document.documentElement);
            this.colors = {
                defaultTop: new he(e.getPropertyValue("--color-temp-high").trim()),
                defaultBottom: new he(e.getPropertyValue("--color-temp-low").trim()),
                heatTop: new he(e.getPropertyValue("--color-temp-heat-high").trim()),
                heatBottom: new he(e.getPropertyValue("--color-temp-heat-low").trim()),
                coldTop: new he(e.getPropertyValue("--color-temp-cold-high").trim()),
                coldBottom: new he(e.getPropertyValue("--color-temp-cold-low").trim()),
                waterDark: new he(e.getPropertyValue("--color-water-dark").trim()),
                waterLight: new he(e.getPropertyValue("--color-water-light").trim())
            }, this.config = {
                voxelWidth: .8,
                voxelDepth: .8,
                monthSpacing: 3.2,
                yearSpacing: 1.2,
                yearLabelX: -1.5,
                yearLabelSize: 30,
                monthLabelSize: 30,
                monthLabelZOffset: 1.5,
                monthLabelYOffset: 0,
                dataLabelSize: 24,
                tempBarYOffset: 1,
                prepBarYOffset: -1
            }, this._introLabelSprites = []
        }
        generate(t, e, n = !1) {
            this.animationStartTime = performance.now(), this.maxDelay = 0, this.labelsAnimated = !1, this.clear();
            let i = 1 / 0,
                a = -1 / 0;
            for (const c in t) t[c].forEach(t => {
                const e = t.absMin ?? t.min,
                    n = t.absMax ?? t.max;
                e < i && (i = e), n > a && (a = n)
            });
            this.globalMin = i === 1 / 0 ? 0 : i, this.globalMax = a === -1 / 0 ? 10 : a;
            let r = this.globalMax - this.globalMin;
            r < 1 && (r = 1), this.scaleFactor = 10 / r;
            let s = 0;
            for (const c in t) t[c].forEach(t => {
                (t.precip || 0) > s && (s = t.precip)
            });
            this.prepScaleFactor = s > 0 ? 6 / s : 0;
            const o = Object.keys(t).length;
            this.numYears = o, this.xCenterOffset = -11 * this.config.monthSpacing / 2, this.zCenterOffset = -(o - 1) * this.config.yearSpacing / 2, this._lastHistoricalData = t, this._lastIsFahrenheit = e, this._lastIsXtreme = n, this._modeTransition = null, this._introLabelSprites = [];
            let l = 0;
            for (const c in t) t[c].forEach((t, i) => {
                this.createVoxel(t, i, l, e, n), this.createPrepVoxel(t, i, l)
            }), this.createYearLabel(c, this.config.yearLabelX, 0, l), l++;
            ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].forEach((t, e) => {
                this.createMonthLabel(t, e * this.config.monthSpacing, this.config.monthLabelYOffset, l - 1 + this.config.monthLabelZOffset, e)
            }), this.group.children.forEach(t => {
                if ("Sprite" !== t.type) return;
                const {
                    isLabel: e,
                    isYearLabel: n,
                    isMonthLabel: i,
                    isPrepLabel: a
                } = t.userData;
                (e || n || i || a) && this._introLabelSprites.push({
                    child: t,
                    isLabel: e,
                    isYearLabel: n,
                    isMonthLabel: i,
                    isPrepLabel: a,
                    isHigh: t.userData.isHigh,
                    baseY: t.userData.baseY || 0,
                    monthIndex: t.userData.monthIndex,
                    yearOffset: t.userData.yearOffset
                })
            })
        }
        createVoxel(t, e, n, i, a = !1) {
            const r = a ? t.absMin ?? t.min : t.min,
                s = a ? t.absMax ?? t.max : t.max,
                o = (r - this.globalMin) * this.scaleFactor,
                l = (s - this.globalMin) * this.scaleFactor,
                c = Math.abs(l - o) || .1,
                h = o + c / 2,
                {
                    colorTop: u,
                    colorBottom: d
                } = this.getTempBarColors(r, s);
            new _i({
                uniforms: {
                    colorBottom: {
                        value: d
                    },
                    colorTop: {
                        value: u
                    },
                    minY: {
                        value: o
                    },
                    maxY: {
                        value: l
                    }
                },
                vertexShader: "\n      varying vec3 vWorldPosition;\n      void main() {\n        vec4 worldPosition = modelMatrix * vec4(position, 1.0);\n        vWorldPosition = worldPosition.xyz;\n        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n      }\n    ",
                fragmentShader: "\n      uniform vec3 colorBottom;\n      uniform vec3 colorTop;\n      uniform float minY;\n      uniform float maxY;\n      varying vec3 vWorldPosition;\n      \n      void main() {\n        // Calculate t from 0 to 1 based on Y position\n        float t = clamp((vWorldPosition.y - minY) / (maxY - minY), 0.0, 1.0);\n        gl_FragColor = vec4(mix(colorBottom, colorTop, t), 1.0);\n      }\n    "
            });
            const p = new ui(this.config.voxelWidth, Math.max(.1, c), this.config.voxelDepth, 1, 1, 1);
            p.translate(0, Math.max(.1, c) / 2, 0);
            const m = [],
                f = p.attributes.position;
            p.computeBoundingBox();
            const g = p.boundingBox,
                _ = new he;
            for (let b = 0; b < f.count; b++) {
                const t = (f.getY(b) - g.min.y) / (g.max.y - g.min.y);
                _.copy(d).lerp(u, t), m.push(_.r, _.g, _.b)
            }
            p.setAttribute("color", new Ze(m, 3));
            const v = new xi({
                    vertexColors: !0,
                    roughness: .2,
                    metalness: .2,
                    transparent: !0,
                    opacity: .8
                }),
                x = new Zn(p, v);
            x.userData = {
                isVoxel: !0,
                yearOffset: n,
                monthIndex: e
            }, x.position.set(e * this.config.monthSpacing + this.xCenterOffset, o + this.config.tempBarYOffset, n * this.config.yearSpacing + this.zCenterOffset), x.scale.y = .001, x.visible = !1, this.group.add(x);
            const M = 100 * e + 150 * n;
            this.maxDelay = Math.max(this.maxDelay, M), this.voxels.push({
                mesh: x,
                data: t,
                x: e,
                z: n,
                centerY: h,
                topY: l,
                bottomY: o,
                isFahrenheit: i,
                delay: M,
                isTempBar: !0
            }), this.createLabel(s, x.position.x, l + .5 + this.config.tempBarYOffset, !0, s, n, e), this.createLabel(r, x.position.x, o - .5 + this.config.tempBarYOffset, !1, r, n, e)
        }
        createYearLabel(t, e, n, i) {
            const a = getComputedStyle(document.documentElement).getPropertyValue("--text-color").trim() || "#e5e5f0",
                r = document.createElement("canvas");
            r.width = 128, r.height = 64;
            const s = r.getContext("2d");
            s.fillStyle = a, s.font = `bold ${this.config.yearLabelSize}px Nunito, sans-serif`, s.textAlign = "right", s.textBaseline = "middle", s.fillText(t, 120, 32);
            const o = new oi(r);
            o.minFilter = m;
            const l = new mn({
                    map: o,
                    depthTest: !1
                }),
                c = new An(l);
            c.position.set(e + this.xCenterOffset, n, i * this.config.yearSpacing + this.zCenterOffset), c.scale.set(1.5, .75, 1), c.renderOrder = 999, c.userData = {
                isYearLabel: !0,
                yearOffset: i,
                baseY: n,
                baseX: e + this.xCenterOffset
            }, c.material.transparent = !0, c.material.opacity = 0, c.visible = !1, this.group.add(c)
        }
        createMonthLabel(t, e, n, i, a) {
            const r = getComputedStyle(document.documentElement).getPropertyValue("--text-color").trim() || "#e5e5f0",
                s = document.createElement("canvas");
            s.width = 128, s.height = 64;
            const o = s.getContext("2d");
            o.fillStyle = r, o.font = `bold ${this.config.monthLabelSize}px Nunito, sans-serif`, o.textAlign = "center", o.textBaseline = "middle", o.fillText(t, 64, 32);
            const l = new oi(s);
            l.minFilter = m;
            const c = new mn({
                    map: l,
                    depthTest: !1
                }),
                h = new An(c);
            h.position.set(e + this.xCenterOffset, n, i * this.config.yearSpacing + this.zCenterOffset), h.scale.set(1.5, .75, 1), h.renderOrder = 999, h.userData = {
                isMonthLabel: !0,
                monthIndex: a,
                baseY: n,
                baseZ: i * this.config.yearSpacing + this.zCenterOffset
            }, h.material.transparent = !0, h.material.opacity = 0, h.visible = !1, this.group.add(h)
        }
        createLabel(t, e, n, i, a, r, s) {
            let o = i ? "--color-temp-label-high" : "--color-temp-label-low";
            i && a >= 40 && (o = "--color-temp-heat-label"), !i && a <= 0 && (o = "--color-temp-cold-label");
            const l = getComputedStyle(document.documentElement).getPropertyValue(o).trim() || "#ffffff",
                c = document.createElement("canvas");
            c.width = 128, c.height = 64;
            const h = c.getContext("2d");
            h.fillStyle = l, h.font = `bold ${this.config.dataLabelSize}px Nunito, sans-serif`, h.textAlign = "center", h.textBaseline = "middle", h.fillText(`${Math.round(t)}°`, 64, 32);
            const u = new oi(c);
            u.minFilter = m;
            const d = new mn({
                    map: u,
                    depthTest: !1
                }),
                p = new An(d);
            p.position.set(e, n, r * this.config.yearSpacing + this.zCenterOffset), p.scale.set(1.5, .75, 1), p.renderOrder = 999, p.userData = {
                isLabel: !0,
                tempC: t,
                isHigh: i,
                rawTempC: a,
                x: e,
                y: n,
                baseY: n,
                yearOffset: r,
                monthIndex: s
            }, p.material.transparent = !0, p.material.opacity = 0, p.visible = !1, this.group.add(p)
        }
        createPrepVoxel(t, e, n) {
            const i = t.precip || 0,
                a = Math.max(.1, i * this.prepScaleFactor),
                r = new ui(this.config.voxelWidth, a, this.config.voxelDepth, 1, 1, 1);
            r.translate(0, -a / 2, 0);
            const s = [],
                o = r.attributes.position;
            r.computeBoundingBox();
            const l = r.boundingBox,
                c = new he;
            for (let m = 0; m < o.count; m++) {
                const t = (o.getY(m) - l.min.y) / (l.max.y - l.min.y);
                c.copy(this.colors.waterLight).lerp(this.colors.waterDark, t), s.push(c.r, c.g, c.b)
            }
            r.setAttribute("color", new Ze(s, 3));
            const h = new xi({
                    vertexColors: !0,
                    roughness: .2,
                    metalness: .2,
                    transparent: !0,
                    opacity: .8
                }),
                u = new Zn(r, h);
            u.userData = {
                isPrepVoxel: !0,
                yearOffset: n,
                monthIndex: e
            }, u.position.set(e * this.config.monthSpacing + this.xCenterOffset, this.config.prepBarYOffset, n * this.config.yearSpacing + this.zCenterOffset), u.scale.y = .001, u.visible = !1, this.group.add(u);
            const d = 100 * e + 150 * n;
            this.maxDelay = Math.max(this.maxDelay, d), this.voxels.push({
                mesh: u,
                delay: d
            });
            const p = this.config.prepBarYOffset - a - .5;
            this.createPrepLabel(i, e * this.config.monthSpacing + this.xCenterOffset, p, n, e)
        }
        createPrepLabel(t, e, n, i, a) {
            const r = getComputedStyle(document.documentElement).getPropertyValue("--color-water-label").trim() || "#496eb3",
                s = document.createElement("canvas");
            s.width = 128, s.height = 64;
            const o = s.getContext("2d");
            o.fillStyle = r, o.font = `bold ${this.config.dataLabelSize}px Nunito, sans-serif`, o.textAlign = "center", o.textBaseline = "middle", o.fillText(`${Math.round(t)}`, 64, 32);
            const l = new oi(s);
            l.minFilter = m;
            const c = new mn({
                    map: l,
                    depthTest: !1
                }),
                h = new An(c);
            h.position.set(e, n, i * this.config.yearSpacing + this.zCenterOffset), h.scale.set(1.5, .75, 1), h.renderOrder = 999, h.userData = {
                isPrepLabel: !0,
                precip: t,
                baseY: n,
                yearOffset: i,
                monthIndex: a
            }, h.material.transparent = !0, h.material.opacity = 0, h.visible = !1, this.group.add(h)
        }
        updateUnit(t) {
            if (!this._lastHistoricalData) return;
            this._exitRafId && cancelAnimationFrame(this._exitRafId), this._transitionTimer && clearTimeout(this._transitionTimer), this._modeFadeRafId && cancelAnimationFrame(this._modeFadeRafId), this._inModeTransition = !0;
            const e = [];
            this.group.children.forEach(t => {
                t.userData.isLabel && (t.userData._exitStartY = t.position.y, t.userData._exitStartOp = t.material.opacity, e.push(t))
            });
            const n = {
                    high: getComputedStyle(document.documentElement).getPropertyValue("--color-temp-label-high").trim() || "#ffffff",
                    low: getComputedStyle(document.documentElement).getPropertyValue("--color-temp-label-low").trim() || "#ffffff",
                    heat: getComputedStyle(document.documentElement).getPropertyValue("--color-temp-heat-label").trim() || "#ffffff",
                    cold: getComputedStyle(document.documentElement).getPropertyValue("--color-temp-cold-label").trim() || "#ffffff"
                },
                i = new Map;
            e.forEach(e => {
                const a = e.userData.rawTempC,
                    r = t ? Math.round(9 * a / 5 + 32) : Math.round(a);
                let s = e.userData.isHigh ? n.high : n.low;
                a >= 40 ? s = n.heat : a <= 0 && (s = n.cold);
                const o = document.createElement("canvas");
                o.width = 128, o.height = 64;
                const l = o.getContext("2d");
                l.fillStyle = s, l.font = `bold ${this.config.dataLabelSize}px Nunito, sans-serif`, l.textAlign = "center", l.textBaseline = "middle", l.fillText(`${r}°`, 64, 32);
                const c = new oi(o);
                c.minFilter = m, i.set(e, {
                    texture: c,
                    baseY: e.userData.baseY,
                    tempC: a
                })
            }), this._lastIsFahrenheit = t;
            const a = performance.now(),
                r = () => {
                    const t = Math.min((performance.now() - a) / 500, 1),
                        n = t * t;
                    if (e.forEach(t => {
                            const e = t.userData._exitStartY ?? t.userData.baseY ?? 0,
                                i = t.userData._exitStartOp ?? 1;
                            t.material.opacity = i * (1 - n), t.position.y = t.userData.isHigh ? e - .5 * n : e + .5 * n
                        }), t < 1) return void(this._exitRafId = requestAnimationFrame(r));
                    this._exitRafId = null;
                    const s = () => {
                        i.forEach((t, e) => {
                            e.material.map && e.material.map.dispose(), e.material.map = t.texture, e.material.needsUpdate = !0, e.material.opacity = 0, e.position.y = e.userData.isHigh ? t.baseY - .5 : t.baseY + .5, e.userData.tempC = t.tempC, e.userData.rawTempC = t.tempC, e.visible = !0
                        });
                        let t = null;
                        const n = () => {
                            const i = performance.now();
                            null === t && (t = i);
                            const a = Math.min((i - t) / 500, 1),
                                r = 1 - Math.pow(1 - a, 3);
                            e.forEach(t => {
                                const e = this.getFocusTargetOpacity(t);
                                t.visible = e > 0, t.material.opacity = r * e;
                                const n = t.userData.baseY || 0;
                                t.position.y = t.userData.isHigh ? n - .5 + .5 * r : n + .5 - .5 * r
                            }), a < 1 ? this._modeFadeRafId = requestAnimationFrame(n) : (e.forEach(t => {
                                t.position.y = t.userData.baseY || 0, t.material.opacity = this.getFocusTargetOpacity(t), delete t.userData._exitStartY, delete t.userData._exitStartOp
                            }), this.applyFocusState({
                                immediate: !0
                            }), this._modeFadeRafId = null, this._inModeTransition = !1)
                        };
                        this._modeFadeRafId = requestAnimationFrame(n)
                    };
                    this._transitionTimer = setTimeout(() => {
                        this._transitionTimer = null, s()
                    }, 200)
                };
            this._exitRafId = requestAnimationFrame(r)
        }
        updateTheme(t) {}
        getFocusTargetOpacity(t) {
            return t.userData.isLabel || t.userData.isPrepLabel ? null !== this.focusedMonth ? t.userData.monthIndex === this.focusedMonth ? 1 : 0 : null !== this.focusedYearOffset ? t.userData.yearOffset === this.focusedYearOffset ? 1 : 0 : 1 : t.userData.isMonthLabel ? null !== this.focusedMonth ? t.userData.monthIndex === this.focusedMonth ? 1 : .08 : 1 : t.userData.isYearLabel ? null !== this.focusedYearOffset ? t.userData.yearOffset === this.focusedYearOffset ? 1 : .08 : 1 : "Mesh" === t.type ? .8 : 1
        }
        syncFocusState(t, {
            immediate: e = !1
        } = {}) {
            if ("Mesh" === t.type) {
                let n = .8;
                return null !== this.focusedMonth ? n = t.userData.monthIndex === this.focusedMonth ? .95 : .08 : null !== this.focusedYearOffset && (n = t.userData.yearOffset === this.focusedYearOffset ? .95 : .08), t.userData.targetOpacity = n, void(e && (t.material.opacity = n, delete t.userData.targetOpacity))
            }
            if ("Sprite" !== t.type) return;
            const n = t.userData.isLabel || t.userData.isPrepLabel,
                i = this.getFocusTargetOpacity(t);
            if (n) return t.visible = i > 0, void(e ? (t.material.opacity = i, delete t.userData.targetOpacity) : t.userData.targetOpacity = i);
            t.userData.isYearLabel && (t.userData.targetX = null !== this.focusedMonth ? this.focusedMonth * this.config.monthSpacing + this.xCenterOffset : t.userData.baseX), t.userData.isMonthLabel && (t.userData.targetZ = null !== this.focusedYearOffset ? this.focusedYearOffset * this.config.yearSpacing + this.zCenterOffset : t.userData.baseZ), t.visible = !0, e ? (t.material.opacity = i, delete t.userData.targetOpacity) : t.userData.targetOpacity = i
        }
        applyFocusState({
            immediate: t = !1
        } = {}) {
            this.group.children.forEach(e => this.syncFocusState(e, {
                immediate: t
            }))
        }
        getTempBarColors(t, e) {
            let n = this.colors.defaultTop,
                i = this.colors.defaultBottom;
            return e >= 40 ? n = this.colors.heatTop : e <= 0 && (n = this.colors.coldTop), t >= 40 ? i = this.colors.heatBottom : t <= 0 && (i = this.colors.coldBottom), {
                colorTop: n,
                colorBottom: i
            }
        }
        applyTempBarVertexColors(t, e, n) {
            const i = t.geometry.getAttribute("color"),
                a = t.geometry.getAttribute("position");
            if (!i || !a) return;
            t.geometry.boundingBox || t.geometry.computeBoundingBox();
            const r = t.geometry.boundingBox,
                s = new he;
            for (let o = 0; o < i.count; o++) {
                const t = (a.getY(o) - r.min.y) / (r.max.y - r.min.y);
                s.copy(e).lerp(n, t), i.setXYZ(o, s.r, s.g, s.b)
            }
            i.needsUpdate = !0
        }
        transitionTo(t, e, n) {
            const i = {};
            let a = 0;
            for (const p in t) t[p].forEach((t, e) => {
                const r = n ? t.absMin ?? t.min : t.min,
                    s = n ? t.absMax ?? t.max : t.max,
                    o = (r - this.globalMin) * this.scaleFactor,
                    l = (s - this.globalMin) * this.scaleFactor,
                    c = Math.max(.1, Math.abs(l - o));
                i[`${a}_${e}`] = {
                    min: r,
                    max: s,
                    bottomY: o,
                    topY: l,
                    height: c
                }
            }), a++;
            this._modeMorph = {
                startTime: 0,
                duration: 1e3
            }, this._exitRafId && cancelAnimationFrame(this._exitRafId), this._transitionTimer && clearTimeout(this._transitionTimer), this._modeFadeRafId && cancelAnimationFrame(this._modeFadeRafId), this._inModeTransition = !0, this.group.children.forEach(t => {
                t.userData.isLabel && (t.userData._exitStartY = t.position.y, t.userData._exitStartOp = t.material.opacity)
            });
            const r = [];
            this.group.children.forEach(t => {
                t.userData.isLabel && r.push(t)
            });
            const s = new Map;
            this.voxels.forEach(t => {
                t.isTempBar && s.set(`${t.z}_${t.x}`, t)
            });
            const o = new Map;
            r.forEach(t => {
                const e = t.userData.isHigh ? "high" : "low";
                o.set(`${t.userData.yearOffset}_${t.userData.monthIndex}_${e}`, t)
            });
            const l = {
                    high: getComputedStyle(document.documentElement).getPropertyValue("--color-temp-label-high").trim() || "#ffffff",
                    low: getComputedStyle(document.documentElement).getPropertyValue("--color-temp-label-low").trim() || "#ffffff",
                    heat: getComputedStyle(document.documentElement).getPropertyValue("--color-temp-heat-label").trim() || "#ffffff",
                    cold: getComputedStyle(document.documentElement).getPropertyValue("--color-temp-cold-label").trim() || "#ffffff"
                },
                c = {};
            s.forEach((t, e) => {
                const n = i[e];
                if (!n) return;
                void 0 === t.mesh.userData.origHeight && (t.mesh.userData.origHeight = t.mesh.geometry.parameters && t.mesh.geometry.parameters.height || Math.max(.1, Math.abs(t.topY - t.bottomY)));
                const a = Math.max(.1, Math.abs(t.topY - t.bottomY)),
                    r = n.height / t.mesh.userData.origHeight,
                    s = a / t.mesh.userData.origHeight;
                c[`${t.z}_${t.x}`] = {
                    startTime: null,
                    duration: this._modeMorph.duration,
                    startBaseY: t.bottomY + this.config.tempBarYOffset,
                    startScaleY: s,
                    targetBaseY: n.bottomY + this.config.tempBarYOffset,
                    targetScaleY: r,
                    startTopY: t.topY,
                    bottomY: n.bottomY,
                    height: n.height,
                    topY: n.topY,
                    min: n.min,
                    max: n.max
                }
            }), this._lastHistoricalData = t, this._lastIsFahrenheit = e, this._lastIsXtreme = n;
            const h = new Map;
            s.forEach((t, n) => {
                const a = i[n];
                if (!a) return;
                const r = a.topY + .5 + this.config.tempBarYOffset,
                    s = a.bottomY - .5 + this.config.tempBarYOffset,
                    c = o.get(`${t.z}_${t.x}_high`),
                    u = o.get(`${t.z}_${t.x}_low`);
                if (c) {
                    const t = a.max;
                    h.set(c, {
                        newBaseY: r,
                        newTempC: t,
                        displayTemp: e ? Math.round(9 * t / 5 + 32) : Math.round(t),
                        colorHex: t >= 40 ? l.heat : l.high,
                        texture: null,
                        labelText: `${e?Math.round(9*t/5+32):Math.round(t)}°`
                    })
                }
                if (u) {
                    const t = a.min;
                    h.set(u, {
                        newBaseY: s,
                        newTempC: t,
                        displayTemp: e ? Math.round(9 * t / 5 + 32) : Math.round(t),
                        colorHex: t <= 0 ? l.cold : l.low,
                        texture: null,
                        labelText: `${e?Math.round(9*t/5+32):Math.round(t)}°`
                    })
                }
            }), h.forEach(t => {
                const e = document.createElement("canvas");
                e.width = 128, e.height = 64;
                const n = e.getContext("2d");
                n.fillStyle = t.colorHex, n.font = `bold ${this.config.dataLabelSize}px Nunito, sans-serif`, n.textAlign = "center", n.textBaseline = "middle", n.fillText(t.labelText, 64, 32);
                const i = new oi(e);
                i.minFilter = m, t.texture = i
            });
            const u = performance.now(),
                d = () => {
                    const t = Math.min((performance.now() - u) / 500, 1),
                        e = t * t;
                    if (r.forEach(t => {
                            const n = t.userData._exitStartY ?? t.userData.baseY ?? 0,
                                i = t.userData._exitStartOp ?? 1;
                            t.material.opacity = i * (1 - e), t.position.y = t.userData.isHigh ? n - .5 * e : n + .5 * e
                        }), t < 1) return void(this._exitRafId = requestAnimationFrame(d));
                    this._exitRafId = null;
                    const n = () => {
                        const t = performance.now();
                        this._modeMorph.startTime = t, this.voxels.forEach(e => {
                            if (!e.isTempBar) return;
                            if (!i[`${e.z}_${e.x}`]) return;
                            const n = e.mesh.userData.morphTarget;
                            n && (n.startTime = t)
                        });
                        let e = null,
                            n = null;
                        const a = () => {
                            if (this.voxels.some(t => t.isTempBar && t.mesh.userData.morphTarget)) return n = null, void(this._modeFadeRafId = requestAnimationFrame(a));
                            const t = performance.now();
                            if (null === n && (n = t), t - n < 100) return this.group.children.forEach(t => {
                                t.userData.isLabel && (t.visible = !1, t.material.opacity = 0, t.position.y = t.userData.isHigh ? (t.userData.baseY || 0) - .5 : (t.userData.baseY || 0) + .5)
                            }), void(this._modeFadeRafId = requestAnimationFrame(a));
                            null === e && (e = t);
                            const i = Math.min((performance.now() - e) / 500, 1),
                                r = 1 - Math.pow(1 - i, 3);
                            this.group.children.forEach(t => {
                                if (!t.userData.isLabel) return;
                                const e = this.getFocusTargetOpacity(t);
                                t.visible = e > 0, t.material.opacity = r * e;
                                const n = t.userData.baseY || 0;
                                t.position.y = t.userData.isHigh ? n - .5 + .5 * r : n + .5 - .5 * r
                            }), i < 1 ? this._modeFadeRafId = requestAnimationFrame(a) : (this.group.children.forEach(t => {
                                t.userData.isLabel && (t.position.y = t.userData.baseY || 0, t.material.opacity = this.getFocusTargetOpacity(t))
                            }), this.applyFocusState({
                                immediate: !0
                            }), this._modeFadeRafId = null, this._modeMorph = null, this._inModeTransition = !1)
                        };
                        this._modeFadeRafId = requestAnimationFrame(a)
                    };
                    r.forEach(t => {
                        delete t.userData.targetOpacity
                    });
                    const a = () => {
                        this.voxels.forEach(t => {
                            if (!t.isTempBar) return;
                            const e = c[`${t.z}_${t.x}`];
                            if (!e) return;
                            t.mesh.userData.morphTarget = {
                                ...e
                            };
                            const {
                                colorTop: n,
                                colorBottom: i
                            } = this.getTempBarColors(e.min, e.max);
                            this.applyTempBarVertexColors(t.mesh, i, n)
                        }), h.forEach((t, e) => {
                            e.material.map && e.material.map.dispose(), e.material.map = t.texture, e.material.needsUpdate = !0, e.position.y = e.userData.isHigh ? t.newBaseY - .5 : t.newBaseY + .5, e.material.opacity = 0, e.userData.baseY = t.newBaseY, e.userData.tempC = t.newTempC, e.userData.rawTempC = t.newTempC, delete e.userData._exitStartY, delete e.userData._exitStartOp, e.visible = !0
                        }), n()
                    };
                    a()
                };
            this._exitRafId = requestAnimationFrame(d)
        }
        update(e) {
            if (0 === this.voxels.length) return;
            const n = e - this.animationStartTime;
            if (this.voxels.forEach(t => {
                    if (t.introDone) {
                        const n = t.mesh.userData.morphTarget;
                        if (n && t.isTempBar) {
                            const i = n.targetBaseY,
                                a = n.targetScaleY,
                                r = n.startTime ?? this._modeMorph?.startTime ?? e,
                                s = n.duration ?? this._modeMorph?.duration ?? 500,
                                o = Math.min(Math.max((e - r) / s, 0), 1),
                                l = o;
                            if (t.mesh.position.y = n.startBaseY + (i - n.startBaseY) * l, t.mesh.scale.y = n.startScaleY + (a - n.startScaleY) * l, o >= 1) {
                                t.mesh.position.y = i, t.mesh.scale.y = a, t.bottomY = n.bottomY, t.topY = n.topY;
                                const {
                                    colorTop: e,
                                    colorBottom: r
                                } = this.getTempBarColors(n.min, n.max);
                                this.applyTempBarVertexColors(t.mesh, r, e), delete t.mesh.userData.morphTarget
                            }
                        }
                        return
                    }
                    const i = Math.max(0, (n - t.delay) / 800);
                    if (i <= 0) return void(t.mesh.visible = !1);
                    t.mesh.visible = !0;
                    const a = Math.min(1, 1 - Math.pow(1 - Math.min(i, 1), 3));
                    t.mesh.scale.y = a, a >= 1 && (t.introDone = !0)
                }), !this.labelsAnimated && !this._inModeTransition) {
                const e = this.maxDelay + t.INTRO_LABEL_DELAY_OFFSET,
                    i = t.INTRO_LABEL_DURATION,
                    a = Math.max(0, (n - e) / i);
                if (a > 0) {
                    const t = Math.min(a, 1);
                    this._introLabelSprites.forEach(e => {
                        const {
                            child: n,
                            isLabel: i,
                            isYearLabel: a,
                            isMonthLabel: r,
                            isPrepLabel: s,
                            isHigh: o,
                            baseY: l,
                            monthIndex: c,
                            yearOffset: h
                        } = e;
                        let u = t,
                            d = !0;
                        null !== this.focusedMonth ? i || s ? d = c === this.focusedMonth : r && c !== this.focusedMonth && (u = .08 * t) : null !== this.focusedYearOffset && (i || s ? d = h === this.focusedYearOffset : a && h !== this.focusedYearOffset && (u = .08 * t)), n.visible = d, n.material.opacity = u, n.position.y = i ? o ? l - .5 + .5 * t : l + .5 - .5 * t : s ? l + .5 - .5 * t : l
                    }), a >= 1 && (this.labelsAnimated = !0)
                }
            }
            this.group.children.forEach(t => {
                if (void 0 !== t.userData.targetOpacity) {
                    const e = t.userData.targetOpacity - t.material.opacity;
                    t.material.opacity += .1 * e, Math.abs(e) < .005 && (t.material.opacity = t.userData.targetOpacity, delete t.userData.targetOpacity)
                }
                if ("Sprite" === t.type) {
                    if (void 0 !== t.userData.targetX) {
                        const e = t.userData.targetX - t.position.x;
                        t.position.x += .12 * e, Math.abs(e) < .01 && (t.position.x = t.userData.targetX, delete t.userData.targetX)
                    }
                    if (void 0 !== t.userData.targetZ) {
                        const e = t.userData.targetZ - t.position.z;
                        t.position.z += .12 * e, Math.abs(e) < .01 && (t.position.z = t.userData.targetZ, delete t.userData.targetZ)
                    }
                }
            })
        }
        handleClick(t) {
            if (0 === this.group.children.length) return;
            const e = t.intersectObjects(this.group.children, !1);
            if (e.length > 0) {
                const t = e[0].object;
                if (t.userData.isMonthLabel) {
                    const e = t.userData.monthIndex;
                    return void(this.focusedMonth === e ? this.clearFocus() : this.setMonthFocus(e))
                }
                if (t.userData.isYearLabel) {
                    const e = t.userData.yearOffset;
                    return void(this.focusedYearOffset === e ? this.clearFocus() : this.setFocus(e))
                }
                const n = t.userData.yearOffset;
                if (void 0 !== n) return void(null !== this.focusedMonth ? t.userData.monthIndex === this.focusedMonth ? this.setFocus(n) : this.setMonthFocus(t.userData.monthIndex) : null !== this.focusedYearOffset && n === this.focusedYearOffset ? this.setMonthFocus(t.userData.monthIndex) : this.setFocus(n))
            }
            null === this.focusedYearOffset && null === this.focusedMonth || this.clearFocus()
        }
        setMonthFocus(t) {
            this.focusedMonth = t, this.focusedYearOffset = null, this.applyFocusState(), this.onFocusChange && this.onFocusChange()
        }
        setFocus(t) {
            this.focusedYearOffset = t, this.focusedMonth = null, this.applyFocusState(), this.onFocusChange && this.onFocusChange()
        }
        clearFocus() {
            this.focusedYearOffset = null, this.focusedMonth = null, this.applyFocusState(), this.onFocusChange && this.onFocusChange()
        }
        fadeOut(t = 1e3) {
            return new Promise(e => {
                this._fadeRafId && cancelAnimationFrame(this._fadeRafId);
                let n = null;
                const i = [];
                if (this.group.children.forEach(t => {
                        t.material && t.material.opacity > 0 && (i.push({
                            child: t,
                            startOpacity: t.material.opacity
                        }), t.material.transparent = !0)
                    }), 0 === i.length) return void e();
                const a = r => {
                    n || (n = r);
                    const s = r - n,
                        o = Math.min(s / t, 1);
                    i.forEach(t => {
                        t.child.material.opacity = t.startOpacity * (1 - o)
                    }), o < 1 ? this._fadeRafId = requestAnimationFrame(a) : (this._fadeRafId = null, e())
                };
                this._fadeRafId = requestAnimationFrame(a)
            })
        }
        clear() {
            for (this._fadeRafId && (cancelAnimationFrame(this._fadeRafId), this._fadeRafId = null), this.focusedYearOffset = null, this.focusedMonth = null, this.voxels.forEach(t => {
                    t.mesh.geometry.dispose(), t.mesh.material.dispose()
                }), this.voxels = []; this.group.children.length > 0;) {
                const t = this.group.children[0];
                t.material && t.material.dispose(), t.material && t.material.map && t.material.map.dispose(), this.group.remove(t)
            }
        }
    },
    Go = class {
        constructor(t) {
            this.container = t, this.config = {
                defaultCameraPos: new rt(-41.68, 60.23, 39.73),
                defaultCameraTarget: new rt(0, 6, 0),
                focusMinPadding: .8,
                focusPaddingRatio: .04,
                focusVerticalBiasRatio: -.065,
                focusVerticalBiasMax: 0,
                focusMinDistance: 24
            }, this.scene = new de, this.camera = new Xi(45, window.innerWidth / window.innerHeight, .1, 1e3), this.camera.position.copy(this.config.defaultCameraPos), this.camera.lookAt(this.config.defaultCameraTarget), this.renderer = new ao({
                antialias: !0,
                alpha: !0
            }), this.renderer.setSize(window.innerWidth, window.innerHeight), this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)), this.container.appendChild(this.renderer.domElement), this.controls = new ko(this.camera, this.renderer.domElement), this.controls.enableDamping = !0, this.controls.dampingFactor = .05, this.controls.screenSpacePanning = !1, this.controls.rotateSpeed = 1.2, this.controls.mouseButtons = {
                LEFT: null,
                MIDDLE: n,
                RIGHT: e
            }, this.controls.touches = {
                ONE: null,
                TWO: s
            }, this._setupCustomPan(), this._setupTwistGesture(), this.controls.minDistance = 5, this.controls.maxDistance = 150, this.controls.maxPolarAngle = .9 * Math.PI, this.controls.minPolarAngle = Math.PI / 12, this.controls.target.copy(this.config.defaultCameraTarget), this.panOffset = {
                x: 0,
                y: 0
            }, this._keysHeld = new Set, this._isInputFocused = () => !1, this.controls.addEventListener("end", () => {});
            const i = new Zi(16777215, .6);
            this.scene.add(i);
            const a = new qi(16777215, .8);
            a.position.set(2, 15, 40), this.scene.add(a);
            const r = new qi(16777215, .4);
            r.position.set(-20, 10, 20), this.scene.add(r);
            const o = new qi(16777215, .3);
            o.position.set(20, 5, 20), this.scene.add(o), this.weatherDataGroup = new ie, this.scene.add(this.weatherDataGroup), this.weather3D = new Ho(this.weatherDataGroup), this.raycaster = new oa, this.mouse = new it, this._mouseDownPos = {
                x: 0,
                y: 0
            }, this.renderer.domElement.addEventListener("mousedown", t => {
                this._mouseDownPos = {
                    x: t.clientX,
                    y: t.clientY
                }
            }), this.renderer.domElement.addEventListener("click", this.onMouseClick.bind(this)), window.addEventListener("resize", this.onWindowResize.bind(this)), this.captionEl = document.createElement("div"), this.captionEl.id = "flythrough-caption", this.container.appendChild(this.captionEl), this.animate = this.animate.bind(this), this.animate()
        }
        onMouseClick(t) {
            this.cancelFlythrough();
            const e = t.clientX - this._mouseDownPos.x,
                n = t.clientY - this._mouseDownPos.y;
            if (Math.sqrt(e * e + n * n) > 5) return;
            const i = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = (t.clientX - i.left) / i.width * 2 - 1, this.mouse.y = -(t.clientY - i.top) / i.height * 2 + 1, this.raycaster.setFromCamera(this.mouse, this.camera), this.weather3D && this.weather3D.handleClick(this.raycaster)
        }
        onWindowResize() {
            this.camera.aspect = window.innerWidth / window.innerHeight, this.camera.updateProjectionMatrix(), this.renderer.setSize(window.innerWidth, window.innerHeight), this._applyCameraOffset()
        }
        _applyCameraOffset() {
            const t = this.renderer.domElement.clientWidth || window.innerWidth,
                e = this.renderer.domElement.clientHeight || window.innerHeight;
            0 === this.panOffset.x && 0 === this.panOffset.y ? this.camera.clearViewOffset() : this.camera.setViewOffset(t, e, -this.panOffset.x, -this.panOffset.y, t, e)
        }
        _bakeOffsetIntoWorld() {
            if (0 === this.panOffset.x && 0 === this.panOffset.y) return;
            const t = new ei(new rt(0, 1, 0), -this.controls.target.y),
                e = new rt;
            if (this.raycaster.setFromCamera(new it(0, 0), this.camera), this.raycaster.ray.intersectPlane(t, e)) {
                const t = e.sub(this.controls.target);
                this.camera.position.add(t), this.controls.target.add(t)
            }
            this.panOffset.x = 0, this.panOffset.y = 0, this._applyCameraOffset()
        }
        _flyTo(t, e, n = 1200, i = "easeInOut") {
            return this._flyResolve && this._flyResolve(!1), new Promise(a => {
                this._flyStart = {
                    pos: this.camera.position.clone(),
                    target: this.controls.target.clone(),
                    panX: this.panOffset.x,
                    panY: this.panOffset.y
                }, this._flyDest = {
                    pos: t.clone(),
                    target: e.clone(),
                    panX: 0,
                    panY: 0
                }, this._flying = !0, this._flyStartTime = performance.now(), this._flyDuration = n, this._flyEasing = i, this._flyResolve = a
            })
        }
        _clearControlInertia() {
            this.controls._sphericalDelta && this.controls._sphericalDelta.set(0, 0, 0), this.controls._panOffset && this.controls._panOffset.set(0, 0, 0), "number" == typeof this.controls._scale && (this.controls._scale = 1), "_performCursorZoom" in this.controls && (this.controls._performCursorZoom = !1), "number" == typeof this.controls.state && (this.controls.state = -1)
        }
        _applyCameraPose(t, e) {
            this._flying = !1, this.camera.position.copy(t), this.controls.target.copy(e), this.panOffset.x = 0, this.panOffset.y = 0, this._clearControlInertia(), this._applyCameraOffset(), this.camera.lookAt(e), this.controls.update()
        }
        resetCamera({
            animate: t = !0,
            duration: e = 2e3,
            easing: n = "easeInOut"
        } = {}) {
            return t ? this._flyTo(this.config.defaultCameraPos, this.config.defaultCameraTarget, e, n) : (this._applyCameraPose(this.config.defaultCameraPos, this.config.defaultCameraTarget), Promise.resolve(!0))
        }
        _getViewportAspect() {
            const t = this.renderer.domElement.clientWidth || window.innerWidth,
                e = this.renderer.domElement.clientHeight || window.innerHeight;
            return e > 0 ? t / e : 1
        }
        _getFocusFrame(t, e) {
            const n = this.weather3D;
            if (!n || 0 === n.group.children.length) return null;
            this.scene.updateMatrixWorld(!0);
            const i = "month" === t,
                a = i ? "z" : "x",
                r = i ? e * n.config.monthSpacing + n.xCenterOffset : e * n.config.yearSpacing + n.zCenterOffset,
                s = e * n.config.monthSpacing + n.xCenterOffset,
                o = e * n.config.yearSpacing + n.zCenterOffset;
            let l = 1 / 0,
                c = -1 / 0,
                h = 1 / 0,
                u = -1 / 0;
            if (n.group.children.forEach(t => {
                    if (!(t => {
                            const n = t.userData || {};
                            return "Mesh" === t.type ? i ? n.monthIndex === e : n.yearOffset === e : "Sprite" === t.type && (n.isLabel || n.isPrepLabel ? i ? n.monthIndex === e : n.yearOffset === e : n.isYearLabel ? i || n.yearOffset === e : !(!n.isMonthLabel || i && n.monthIndex !== e))
                        })(t)) return;
                    if ("Mesh" === t.type) {
                        t.geometry.boundingBox || t.geometry.computeBoundingBox();
                        const e = t.geometry.boundingBox.clone().applyMatrix4(t.matrixWorld);
                        return l = Math.min(l, e.min[a]), c = Math.max(c, e.max[a]), h = Math.min(h, e.min.y), void(u = Math.max(u, e.max.y))
                    }
                    if ("Sprite" !== t.type) return;
                    const n = (t => {
                        const e = t.position.clone(),
                            n = t.userData || {};
                        return n.isYearLabel && (e.x = i ? s : n.baseX ?? e.x), n.isMonthLabel && (e.z = i ? n.baseZ ?? e.z : o), e
                    })(t);
                    ((t, e, n, i) => {
                        l = Math.min(l, t - n), c = Math.max(c, t + n), h = Math.min(h, e - i), u = Math.max(u, e + i)
                    })(n[a], n.y, t.scale.x / 2, t.scale.y / 2)
                }), !(Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(h) && Number.isFinite(u))) return null;
            const d = c - l,
                p = u - h,
                m = Math.max(this.config.focusMinPadding, Math.max(d, p) * this.config.focusPaddingRatio),
                f = (l + c) / 2,
                g = (h + u) / 2 - Math.min(p * this.config.focusVerticalBiasRatio, this.config.focusVerticalBiasMax),
                _ = nt.degToRad(this.camera.fov),
                v = 2 * Math.atan(Math.tan(_ / 2) * this._getViewportAspect()),
                x = d / 2 + m,
                M = u - g + m,
                b = g - h + m,
                y = Math.max(x / Math.tan(v / 2), Math.max(M, b) / Math.tan(_ / 2), this.config.focusMinDistance);
            if (i) {
                const t = new rt(r, g, f);
                return {
                    position: new rt(r - y, g, f),
                    target: t
                }
            }
            const S = new rt(f, g, r);
            return {
                position: new rt(f, g, r + y),
                target: S
            }
        }
        flyToMonth(t) {
            const e = this._getFocusFrame("month", t);
            if (e) return this._flyTo(e.position, e.target);
            const n = this.weather3D,
                i = t * n.config.monthSpacing + n.xCenterOffset;
            return this._flyTo(new rt(i - 46, 5, 0), this.config.defaultCameraTarget)
        }
        flyToYear(t) {
            const e = this._getFocusFrame("year", t);
            if (e) return this._flyTo(e.position, e.target);
            const n = this.weather3D,
                i = t * n.config.yearSpacing + n.zCenterOffset;
            return this._flyTo(new rt(0, 5, i + 46), this.config.defaultCameraTarget)
        }
        animate() {
            if (requestAnimationFrame(this.animate), this.weather3D && this.weather3D.update(performance.now()), this._flying) {
                const t = performance.now() - this._flyStartTime;
                let e = Math.min(t / this._flyDuration, 1);
                if ("easeIn" === this._flyEasing ? e *= e * e : "easeOut" === this._flyEasing ? e = 1 - Math.pow(1 - e, 3) : "linear" === this._flyEasing || (e = e < .5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2), this.camera.position.lerpVectors(this._flyStart.pos, this._flyDest.pos, e), this.controls.target.lerpVectors(this._flyStart.target, this._flyDest.target, e), this.panOffset.x = nt.lerp(this._flyStart.panX, this._flyDest.panX, e), this.panOffset.y = nt.lerp(this._flyStart.panY, this._flyDest.panY, e), this._applyCameraOffset(), e >= 1 && (this._flying = !1, this._flyResolve)) {
                    const t = this._flyResolve;
                    this._flyResolve = null, t(!0)
                }
            }
            this._processHeldKeys(), this.controls.update(), this.renderer.render(this.scene, this.camera)
        }
        renderWeather(t, e, n = !1, i = !1) {
            this.cancelFlythrough(), this.weather3D.generate(t, e, i), n || this.resetCamera({
                animate: !1
            })
        }
        updateUnit(t) {
            this.weather3D.updateUnit(t)
        }
        setupKeyboardMovement(t) {
            this._isInputFocused = t, window.addEventListener("keydown", t => {
                this._keysHeld.add(t.key.toLowerCase())
            }), window.addEventListener("keyup", t => {
                this._keysHeld.delete(t.key.toLowerCase())
            }), window.addEventListener("blur", () => {
                this._keysHeld.clear()
            })
        }
        panBy(t, e) {
            this.panOffset.x -= 20 * t, this.panOffset.y += 20 * e, this._applyCameraOffset()
        }
        _processHeldKeys() {
            if (0 === this._keysHeld.size || this._isInputFocused()) return;
            const t = this._keysHeld;
            (t.has("w") || t.has("s") || t.has("a") || t.has("d") || t.has("q") || t.has("e") || t.has("i") || t.has("k") || t.has("j") || t.has("l")) && (this.cancelFlythrough(), t.has("w") && this.panBy(0, -.5), t.has("s") && this.panBy(0, .5), t.has("a") && this.panBy(.5, 0), t.has("d") && this.panBy(-.5, 0), t.has("q") && this._zoomCamera(1.02), t.has("e") && this._zoomCamera(.98), t.has("i") && this._rotatePolar(3), t.has("k") && this._rotatePolar(-3), t.has("j") && this._rotateAzimuth(-.02), t.has("l") && this._rotateAzimuth(.02))
        }
        _setupCustomPan() {
            const t = this.renderer.domElement;
            let e = !1,
                n = 0,
                i = 0;
            t.addEventListener("mousedown", t => {
                0 === t.button && (this.cancelFlythrough(), e = !0, n = t.clientX, i = t.clientY)
            }), window.addEventListener("mousemove", t => {
                if (!e) return;
                const a = t.clientX - n,
                    r = t.clientY - i;
                n = t.clientX, i = t.clientY, this.panOffset.x += a, this.panOffset.y += r, this._applyCameraOffset()
            }), window.addEventListener("mouseup", t => {
                0 === t.button && (e = !1)
            });
            let a = 0,
                r = 0;
            const s = t => {
                1 === t.touches.length && (this.cancelFlythrough(), a = t.touches[0].clientX, r = t.touches[0].clientY)
            };
            t.addEventListener("touchstart", s, {
                passive: !0
            }), t.addEventListener("touchend", s, {
                passive: !0
            }), t.addEventListener("touchmove", t => {
                if (1 !== t.touches.length) return;
                const e = t.touches[0].clientX - a,
                    n = t.touches[0].clientY - r;
                a = t.touches[0].clientX, r = t.touches[0].clientY, this.panOffset.x += e, this.panOffset.y += n, this._applyCameraOffset()
            }, {
                passive: !0
            })
        }
        _setupTwistGesture() {
            const t = this.renderer.domElement;
            let e = null,
                n = null;
            const i = t => ({
                    x: t.clientX,
                    y: t.clientY
                }),
                a = (t, e) => Math.atan2(e.y - t.y, e.x - t.x),
                r = (t, e) => Math.hypot(e.x - t.x, e.y - t.y),
                s = (t, e) => ({
                    x: (t.x + e.x) / 2,
                    y: (t.y + e.y) / 2
                }),
                o = t => {
                    2 === t.touches.length ? (this.cancelFlythrough(), this._bakeOffsetIntoWorld(), e = i(t.touches[0]), n = i(t.touches[1])) : (e = null, n = null)
                };
            t.addEventListener("touchstart", o, {
                passive: !0,
                capture: !0
            }), t.addEventListener("touchmove", o => {
                if (2 !== o.touches.length || !e) return;
                o.stopImmediatePropagation();
                const l = i(o.touches[0]),
                    c = i(o.touches[1]),
                    h = s(e, n),
                    u = s(l, c),
                    d = h.x / t.clientWidth * 2 - 1,
                    p = -h.y / t.clientHeight * 2 + 1;
                this.raycaster.setFromCamera(new it(d, p), this.camera);
                const m = new ei(new rt(0, 1, 0), -this.controls.target.y),
                    f = new rt,
                    g = this.raycaster.ray.intersectPlane(m, f),
                    _ = r(e, n),
                    v = r(l, c);
                _ > 0 && this._zoomCamera(_ / v);
                const x = a(e, n);
                let M = a(l, c) - x;
                M > Math.PI && (M -= 2 * Math.PI), M < -Math.PI && (M += 2 * Math.PI);
                const b = this.camera.position.y < this.controls.target.y ? 1 : -1;
                Math.abs(M) > .003 && this._rotateAzimuth(b * M);
                const y = u.y - h.y,
                    S = u.x - h.x,
                    E = .5 * this.camera.position.distanceTo(this.controls.target),
                    T = Math.abs(y) > 1.5 * Math.abs(S) && Math.abs(y) > .1;
                if (T && this._rotatePolar(-y, E), g && !T) {
                    this.camera.updateMatrixWorld(), this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
                    const e = f.clone().project(this.camera),
                        n = (.5 * e.x + .5) * t.clientWidth,
                        i = (.5 * -e.y + .5) * t.clientHeight;
                    this.panOffset.x += u.x - n, this.panOffset.y += u.y - i, this._applyCameraOffset()
                } else T || (this.panOffset.x += u.x - h.x, this.panOffset.y += u.y - h.y, this._applyCameraOffset());
                e = l, n = c
            }, {
                passive: !0,
                capture: !0
            }), t.addEventListener("touchend", o, {
                passive: !0,
                capture: !0
            }), t.addEventListener("touchcancel", () => {
                e = null, n = null
            }, {
                passive: !0,
                capture: !0
            })
        }
        _zoomCamera(t) {
            const e = this.controls.target,
                n = this.camera.position.clone().sub(e),
                i = nt.clamp(n.length() * t, this.controls.minDistance, this.controls.maxDistance);
            n.normalize().multiplyScalar(i), this.camera.position.copy(e).add(n)
        }
        _rotateAzimuth(t) {
            const e = this.controls.target,
                n = this.camera.position.clone().sub(e),
                i = Math.cos(t),
                a = Math.sin(t),
                r = n.x * i - n.z * a,
                s = n.x * a + n.z * i;
            this.camera.position.setX(e.x + r), this.camera.position.setZ(e.z + s), this.camera.lookAt(e)
        }
        _rotatePolar(t, e = 0) {
            const n = this.controls.target,
                i = n.clone().sub(this.camera.position).normalize(),
                a = n.clone().addScaledVector(i, -e),
                r = this.camera.position.clone().sub(a),
                s = (new ha).setFromVector3(r),
                o = Math.PI / this.renderer.domElement.clientHeight;
            s.phi = nt.clamp(s.phi + t * o * 2, this.controls.minPolarAngle, this.controls.maxPolarAngle), s.makeSafe(), r.setFromSpherical(s), this.camera.position.copy(a).add(r), this.camera.lookAt(n)
        }
        cancelFlythrough() {
            const t = this._isFlythroughRunning;
            this._isFlythroughRunning = !1, this._flying && (this._flying = !1, this._flyResolve && (this._flyResolve(!1), this._flyResolve = null)), this._flythroughTimeout && (clearTimeout(this._flythroughTimeout), this._flythroughTimeout = null), t && (this.showCaption("Flythrough Interrupted", !0), setTimeout(() => {
                this._isFlythroughRunning || this.hideCaption()
            }, 1500))
        }
        showCaption(t, e = !1) {
            this.captionEl && (this.captionEl.textContent = t, this.captionEl.style.opacity = "1", this.captionEl.style.color = e ? "#ff8a8a" : "white", this.captionEl.style.border = e ? "1px solid rgba(255, 138, 138, 0.4)" : "1px solid rgba(255, 255, 255, 0.1)")
        }
        hideCaption() {
            this.captionEl && (this.captionEl.style.opacity = "0")
        }
        async runFlythrough() {
            if (this._isFlythroughRunning) return;
            this._isFlythroughRunning = !0, this.weather3D && this.weather3D.clearFocus();
            const t = t => new Promise(e => {
                    this._flythroughTimeout = setTimeout(e, t)
                }),
                e = () => !this._isFlythroughRunning;
            try {
                this.showCaption("Starting Sequence");
                const n = this.controls.target.clone(),
                    i = this.camera.position.clone().clone().sub(n),
                    a = Math.max(.875 * i.length(), this.controls.minDistance || 5),
                    r = n.clone().add(i.normalize().multiplyScalar(a));
                let s = await this._flyTo(r, n, 1500, "easeIn");
                if (e() || !s) return;
                if (this.showCaption("Resetting to Home View"), s = await this.resetCamera({
                        duration: 3e3,
                        easing: "easeOut"
                    }), e() || !s) return;
                await t(500);
                const o = this.weather3D,
                    l = o ? o.numYears : 0;
                if (0 === l) return;
                this.showCaption("Revealing Precipitation Data");
                const c = new rt(-30, -35, 30),
                    h = new rt(0, 0, 0);
                if (s = await this._flyTo(c, h, 3e3), e() || !s) return;
                await t(1500);
                const u = o._lastHistoricalData ? Object.keys(o._lastHistoricalData) : [],
                    d = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                this.showCaption("Highlighting Data by Year"), await t(800);
                const p = Math.min(17, l);
                for (let g = 0; g < p; g++) {
                    const n = u.length > 0 ? u[g] : "";
                    if (this.showCaption(`Highlighting ${n}`), o && o.setFocus(g), 5 === g) {
                        const t = new rt(-25, 30, 20),
                            e = new rt(0, 4, 0),
                            n = 600 * (p - g);
                        this._flyTo(t, e, n).catch(() => {})
                    }
                    if (e()) return;
                    await t(600)
                }
                this.showCaption("Highlighting Data by Month"), await t(600);
                for (let g = 0; g <= 11; g++) {
                    if (this.showCaption(`Highlighting ${d[g]}`), o && o.setMonthFocus(g), 3 === g) {
                        const t = new rt(20, 30, 25),
                            e = new rt(0, 4, 0),
                            n = 600 * (11 - g + 1);
                        this._flyTo(t, e, n).catch(() => {})
                    }
                    if (e()) return;
                    await t(600)
                }
                o && o.clearFocus(), await t(800);
                const m = u.length > 0 ? u[l - 1] : "";
                if (this.showCaption(`Focusing on Latest Year (${m})`), o && o.setFocus(l - 1), s = await this.flyToYear(l - 1), e() || !s) return;
                await t(1e3);
                const f = Math.min(5, l - 1);
                for (let g = 1; g <= f; g++) {
                    const n = l - 1 - g,
                        i = u.length > 0 ? u[n] : "";
                    if (this.showCaption(`Stepping back to ${i}`), o && o.setFocus(n), s = await this.flyToYear(n), e() || !s) return;
                    await t(800)
                }
                if (this.showCaption("Observing Seasonal Change (Spring)"), o && (o.clearFocus(), o.setMonthFocus(3)), s = await this.flyToMonth(3), e() || !s) return;
                await t(800);
                for (let g = 4; g <= 8; g++) {
                    if (this.showCaption(`Transitioning to ${d[g]}`), o && o.setMonthFocus(g), s = await this.flyToMonth(g), e() || !s) return;
                    await t(800)
                }
                if (this.showCaption("Returning to Global View"), o && o.clearFocus(), s = await this._flyTo(this.config.defaultCameraPos, this.config.defaultCameraTarget, 4e3), e() || !s) return;
                this._isFlythroughRunning = !1, this.hideCaption()
            } finally {
                this.cancelFlythrough()
            }
        }
    },
    Wo = "Singapore",
    Xo = "Singapore, Central Region, Singapore",
    Yo = {
        1996: [{
            month: 0,
            precip: 113.5,
            max: 27.23,
            min: 23.24,
            absMax: 28.7,
            absMin: 22.3
        }, {
            month: 1,
            precip: 152.3,
            max: 27.89,
            min: 25.35,
            absMax: 29.8,
            absMin: 24.1
        }, {
            month: 2,
            precip: 127.6,
            max: 28.65,
            min: 25.42,
            absMax: 29.9,
            absMin: 23.4
        }, {
            month: 3,
            precip: 129.8,
            max: 28.68,
            min: 25.11,
            absMax: 30.2,
            absMin: 23.6
        }, {
            month: 4,
            precip: 126.4,
            max: 29.26,
            min: 25.55,
            absMax: 30.8,
            absMin: 24
        }, {
            month: 5,
            precip: 210.2,
            max: 29.47,
            min: 25.9,
            absMax: 30.7,
            absMin: 24.5
        }, {
            month: 6,
            precip: 286.8,
            max: 29.33,
            min: 25.78,
            absMax: 30.3,
            absMin: 24.1
        }, {
            month: 7,
            precip: 246.5,
            max: 29.36,
            min: 25.64,
            absMax: 30.6,
            absMin: 23.6
        }, {
            month: 8,
            precip: 244.6,
            max: 28.9,
            min: 25.45,
            absMax: 30.1,
            absMin: 24.1
        }, {
            month: 9,
            precip: 191.9,
            max: 28.88,
            min: 25.59,
            absMax: 30.4,
            absMin: 24
        }, {
            month: 10,
            precip: 171.8,
            max: 28.45,
            min: 25.18,
            absMax: 29.9,
            absMin: 23.5
        }, {
            month: 11,
            precip: 150.5,
            max: 27.85,
            min: 24.54,
            absMax: 29.5,
            absMin: 22.6
        }],
        1997: [{
            month: 0,
            precip: 86.4,
            max: 28.38,
            min: 24.74,
            absMax: 30.2,
            absMin: 23.1
        }, {
            month: 1,
            precip: 98.7,
            max: 28.92,
            min: 25.28,
            absMax: 30.1,
            absMin: 23.7
        }, {
            month: 2,
            precip: 110.2,
            max: 29.41,
            min: 25.88,
            absMax: 30.7,
            absMin: 24.5
        }, {
            month: 3,
            precip: 115.3,
            max: 29.39,
            min: 25.67,
            absMax: 30.5,
            absMin: 24
        }, {
            month: 4,
            precip: 158.6,
            max: 29.53,
            min: 25.56,
            absMax: 30.6,
            absMin: 23.8
        }, {
            month: 5,
            precip: 233.7,
            max: 29.68,
            min: 26.17,
            absMax: 31.1,
            absMin: 24.7
        }, {
            month: 6,
            precip: 306.4,
            max: 29.35,
            min: 26.03,
            absMax: 30.8,
            absMin: 24.6
        }, {
            month: 7,
            precip: 265.8,
            max: 29.43,
            min: 25.83,
            absMax: 30.8,
            absMin: 24.2
        }, {
            month: 8,
            precip: 237.6,
            max: 29.08,
            min: 25.73,
            absMax: 30.5,
            absMin: 24.5
        }, {
            month: 9,
            precip: 179.4,
            max: 28.97,
            min: 25.83,
            absMax: 30.6,
            absMin: 24.4
        }, {
            month: 10,
            precip: 137.8,
            max: 28.7,
            min: 25.53,
            absMax: 30.2,
            absMin: 23.8
        }, {
            month: 11,
            precip: 169.2,
            max: 28.16,
            min: 25,
            absMax: 30.4,
            absMin: 23.2
        }],
        1998: [{
            month: 0,
            precip: 135.5,
            max: 27.87,
            min: 24.44,
            absMax: 29.7,
            absMin: 22.7
        }, {
            month: 1,
            precip: 98.9,
            max: 27.71,
            min: 24.3,
            absMax: 29.3,
            absMin: 22.4
        }, {
            month: 2,
            precip: 117.6,
            max: 28.33,
            min: 24.97,
            absMax: 29.8,
            absMin: 23
        }, {
            month: 3,
            precip: 147.2,
            max: 28.58,
            min: 25.18,
            absMax: 29.9,
            absMin: 23.7
        }, {
            month: 4,
            precip: 172.3,
            max: 28.94,
            min: 25.35,
            absMax: 30.4,
            absMin: 24
        }, {
            month: 5,
            precip: 194.5,
            max: 29.2,
            min: 25.62,
            absMax: 30.5,
            absMin: 24.3
        }, {
            month: 6,
            precip: 287.6,
            max: 29.5,
            min: 26.2,
            absMax: 31.5,
            absMin: 25
        }, {
            month: 7,
            precip: 256.3,
            max: 29.47,
            min: 26.09,
            absMax: 30.8,
            absMin: 24.7
        }, {
            month: 8,
            precip: 254.8,
            max: 29.18,
            min: 25.97,
            absMax: 30.6,
            absMin: 24.7
        }, {
            month: 9,
            precip: 208.4,
            max: 29.24,
            min: 26.12,
            absMax: 31.9,
            absMin: 24.8
        }, {
            month: 10,
            precip: 175.3,
            max: 28.74,
            min: 25.7,
            absMax: 30.6,
            absMin: 24.2
        }, {
            month: 11,
            precip: 181.9,
            max: 28.23,
            min: 25.01,
            absMax: 30.2,
            absMin: 23.4
        }],
        1999: [{
            month: 0,
            precip: 128.7,
            max: 27.96,
            min: 24.33,
            absMax: 29.4,
            absMin: 22.6
        }, {
            month: 1,
            precip: 107.5,
            max: 28.31,
            min: 24.65,
            absMax: 29.8,
            absMin: 23.1
        }, {
            month: 2,
            precip: 124.8,
            max: 28.78,
            min: 25.33,
            absMax: 30,
            absMin: 23.9
        }, {
            month: 3,
            precip: 139.2,
            max: 28.79,
            min: 25.31,
            absMax: 30.3,
            absMin: 24
        }, {
            month: 4,
            precip: 163.4,
            max: 29.19,
            min: 25.35,
            absMax: 30.6,
            absMin: 23.8
        }, {
            month: 5,
            precip: 218.9,
            max: 29.58,
            min: 25.96,
            absMax: 31.2,
            absMin: 24.6
        }, {
            month: 6,
            precip: 298.5,
            max: 29.37,
            min: 26.19,
            absMax: 30.8,
            absMin: 25.2
        }, {
            month: 7,
            precip: 264.2,
            max: 29.24,
            min: 26.01,
            absMax: 30.5,
            absMin: 24.6
        }, {
            month: 8,
            precip: 218.3,
            max: 29.01,
            min: 25.78,
            absMax: 30.4,
            absMin: 24.5
        }, {
            month: 9,
            precip: 186.2,
            max: 29.12,
            min: 25.96,
            absMax: 30.7,
            absMin: 24.7
        }, {
            month: 10,
            precip: 158.4,
            max: 28.68,
            min: 25.6,
            absMax: 30.3,
            absMin: 23.8
        }, {
            month: 11,
            precip: 174.6,
            max: 28.21,
            min: 25.02,
            absMax: 30.1,
            absMin: 23.3
        }],
        2e3: [{
            month: 0,
            precip: 117.8,
            max: 27.75,
            min: 24.04,
            absMax: 29.4,
            absMin: 22.4
        }, {
            month: 1,
            precip: 102.3,
            max: 28.05,
            min: 24.4,
            absMax: 29.6,
            absMin: 22.8
        }, {
            month: 2,
            precip: 129.5,
            max: 28.58,
            min: 24.9,
            absMax: 30.3,
            absMin: 23.3
        }, {
            month: 3,
            precip: 142.7,
            max: 28.79,
            min: 25.31,
            absMax: 30.4,
            absMin: 24
        }, {
            month: 4,
            precip: 175.8,
            max: 29.22,
            min: 25.46,
            absMax: 30.7,
            absMin: 24.2
        }, {
            month: 5,
            precip: 207.3,
            max: 29.48,
            min: 25.89,
            absMax: 30.9,
            absMin: 24.5
        }, {
            month: 6,
            precip: 325.4,
            max: 29.55,
            min: 26.31,
            absMax: 31.6,
            absMin: 25
        }, {
            month: 7,
            precip: 251.6,
            max: 29.48,
            min: 26.11,
            absMax: 30.9,
            absMin: 24.8
        }, {
            month: 8,
            precip: 243.7,
            max: 29.1,
            min: 25.88,
            absMax: 30.5,
            absMin: 24.5
        }, {
            month: 9,
            precip: 197.5,
            max: 29.21,
            min: 26.02,
            absMax: 30.8,
            absMin: 24.6
        }, {
            month: 10,
            precip: 166.9,
            max: 28.76,
            min: 25.59,
            absMax: 30.2,
            absMin: 24
        }, {
            month: 11,
            precip: 193.8,
            max: 28.46,
            min: 25.34,
            absMax: 30.5,
            absMin: 23.9
        }],
        2001: [{
            month: 0,
            precip: 131.2,
            max: 27.85,
            min: 24.27,
            absMax: 29.6,
            absMin: 22.8
        }, {
            month: 1,
            precip: 95.6,
            max: 28.16,
            min: 24.52,
            absMax: 29.9,
            absMin: 23.1
        }, {
            month: 2,
            precip: 118.9,
            max: 28.63,
            min: 25.1,
            absMax: 30.1,
            absMin: 23.7
        }, {
            month: 3,
            precip: 136.4,
            max: 28.7,
            min: 25.29,
            absMax: 30,
            absMin: 24
        }, {
            month: 4,
            precip: 159.7,
            max: 29.08,
            min: 25.29,
            absMax: 30.4,
            absMin: 24
        }, {
            month: 5,
            precip: 225.1,
            max: 29.48,
            min: 25.94,
            absMax: 31,
            absMin: 24.4
        }, {
            month: 6,
            precip: 289.3,
            max: 29.4,
            min: 26.14,
            absMax: 30.8,
            absMin: 24.9
        }, {
            month: 7,
            precip: 268.4,
            max: 29.35,
            min: 25.88,
            absMax: 30.7,
            absMin: 24.4
        }, {
            month: 8,
            precip: 229.8,
            max: 29.12,
            min: 25.81,
            absMax: 30.5,
            absMin: 24.5
        }, {
            month: 9,
            precip: 178.9,
            max: 29.09,
            min: 25.87,
            absMax: 30.6,
            absMin: 24.5
        }, {
            month: 10,
            precip: 152.3,
            max: 28.67,
            min: 25.47,
            absMax: 30.2,
            absMin: 23.8
        }, {
            month: 11,
            precip: 180.5,
            max: 28.27,
            min: 25.05,
            absMax: 30.4,
            absMin: 23.4
        }],
        2002: [{
            month: 0,
            precip: 119.4,
            max: 27.98,
            min: 24.34,
            absMax: 29.6,
            absMin: 22.8
        }, {
            month: 1,
            precip: 110.8,
            max: 28.24,
            min: 24.7,
            absMax: 29.7,
            absMin: 23.2
        }, {
            month: 2,
            precip: 142.3,
            max: 28.72,
            min: 25.27,
            absMax: 29.9,
            absMin: 23.8
        }, {
            month: 3,
            precip: 154.6,
            max: 28.78,
            min: 25.4,
            absMax: 30.2,
            absMin: 24.1
        }, {
            month: 4,
            precip: 168.9,
            max: 29.08,
            min: 25.35,
            absMax: 30.1,
            absMin: 24
        }, {
            month: 5,
            precip: 221.5,
            max: 29.37,
            min: 25.79,
            absMax: 30.6,
            absMin: 24.3
        }, {
            month: 6,
            precip: 307.8,
            max: 29.38,
            min: 26.11,
            absMax: 31.1,
            absMin: 25
        }, {
            month: 7,
            precip: 258.2,
            max: 29.34,
            min: 25.96,
            absMax: 30.7,
            absMin: 24.6
        }, {
            month: 8,
            precip: 242.1,
            max: 29.09,
            min: 25.75,
            absMax: 30.5,
            absMin: 24.4
        }, {
            month: 9,
            precip: 191.7,
            max: 29.06,
            min: 25.86,
            absMax: 30.8,
            absMin: 24.5
        }, {
            month: 10,
            precip: 159.2,
            max: 28.62,
            min: 25.38,
            absMax: 30,
            absMin: 23.7
        }, {
            month: 11,
            precip: 176.3,
            max: 28.21,
            min: 24.94,
            absMax: 29.9,
            absMin: 23.1
        }],
        2003: [{
            month: 0,
            precip: 125.3,
            max: 27.81,
            min: 24.1,
            absMax: 29.4,
            absMin: 22.6
        }, {
            month: 1,
            precip: 99.2,
            max: 28.11,
            min: 24.48,
            absMax: 29.6,
            absMin: 23
        }, {
            month: 2,
            precip: 121.6,
            max: 28.53,
            min: 25.02,
            absMax: 29.8,
            absMin: 23.5
        }, {
            month: 3,
            precip: 143.8,
            max: 28.67,
            min: 25.24,
            absMax: 30,
            absMin: 23.9
        }, {
            month: 4,
            precip: 155.2,
            max: 28.95,
            min: 25.18,
            absMax: 30.1,
            absMin: 23.8
        }, {
            month: 5,
            precip: 218.7,
            max: 29.35,
            min: 25.74,
            absMax: 30.8,
            absMin: 24.2
        }, {
            month: 6,
            precip: 289.4,
            max: 29.3,
            min: 26,
            absMax: 30.6,
            absMin: 24.8
        }, {
            month: 7,
            precip: 247.8,
            max: 29.27,
            min: 25.81,
            absMax: 30.6,
            absMin: 24.3
        }, {
            month: 8,
            precip: 228.5,
            max: 28.95,
            min: 25.64,
            absMax: 30.4,
            absMin: 24.2
        }, {
            month: 9,
            precip: 184.3,
            max: 28.97,
            min: 25.7,
            absMax: 30.6,
            absMin: 24.3
        }, {
            month: 10,
            precip: 148.9,
            max: 28.54,
            min: 25.24,
            absMax: 29.9,
            absMin: 23.5
        }, {
            month: 11,
            precip: 170.2,
            max: 28.12,
            min: 24.81,
            absMax: 29.8,
            absMin: 22.8
        }],
        2004: [{
            month: 0,
            precip: 122.7,
            max: 27.89,
            min: 24.21,
            absMax: 29.5,
            absMin: 22.7
        }, {
            month: 1,
            precip: 108.3,
            max: 28.26,
            min: 24.71,
            absMax: 29.8,
            absMin: 23.2
        }, {
            month: 2,
            precip: 131.9,
            max: 28.68,
            min: 25.23,
            absMax: 30,
            absMin: 23.7
        }, {
            month: 3,
            precip: 152.4,
            max: 28.81,
            min: 25.42,
            absMax: 30.3,
            absMin: 24.1
        }, {
            month: 4,
            precip: 169.6,
            max: 29.16,
            min: 25.5,
            absMax: 30.5,
            absMin: 24.2
        }, {
            month: 5,
            precip: 228.3,
            max: 29.5,
            min: 25.97,
            absMax: 31,
            absMin: 24.5
        }, {
            month: 6,
            precip: 318.7,
            max: 29.48,
            min: 26.26,
            absMax: 31.5,
            absMin: 25.1
        }, {
            month: 7,
            precip: 265.9,
            max: 29.43,
            min: 26.07,
            absMax: 30.8,
            absMin: 24.8
        }, {
            month: 8,
            precip: 248.2,
            max: 29.17,
            min: 25.87,
            absMax: 30.6,
            absMin: 24.6
        }, {
            month: 9,
            precip: 195.8,
            max: 29.14,
            min: 25.96,
            absMax: 30.7,
            absMin: 24.6
        }, {
            month: 10,
            precip: 165.4,
            max: 28.73,
            min: 25.52,
            absMax: 30.2,
            absMin: 23.9
        }, {
            month: 11,
            precip: 187.9,
            max: 28.42,
            min: 25.15,
            absMax: 30.2,
            absMin: 23.5
        }],
        2005: [{
            month: 0,
            precip: 129.1,
            max: 27.91,
            min: 24.17,
            absMax: 29.4,
            absMin: 22.5
        }, {
            month: 1,
            precip: 103.7,
            max: 28.19,
            min: 24.57,
            absMax: 29.7,
            absMin: 23
        }, {
            month: 2,
            precip: 127.2,
            max: 28.61,
            min: 25.09,
            absMax: 29.9,
            absMin: 23.6
        }, {
            month: 3,
            precip: 145.9,
            max: 28.75,
            min: 25.31,
            absMax: 30.1,
            absMin: 24
        }, {
            month: 4,
            precip: 162.3,
            max: 29.09,
            min: 25.38,
            absMax: 30.4,
            absMin: 24.1
        }, {
            month: 5,
            precip: 221.8,
            max: 29.44,
            min: 25.88,
            absMax: 30.9,
            absMin: 24.4
        }, {
            month: 6,
            precip: 301.2,
            max: 29.43,
            min: 26.18,
            absMax: 31,
            absMin: 25
        }, {
            month: 7,
            precip: 260.5,
            max: 29.39,
            min: 26,
            absMax: 30.8,
            absMin: 24.6
        }, {
            month: 8,
            precip: 235.9,
            max: 29.08,
            min: 25.82,
            absMax: 30.4,
            absMin: 24.4
        }, {
            month: 9,
            precip: 189.6,
            max: 29.08,
            min: 25.89,
            absMax: 30.6,
            absMin: 24.5
        }, {
            month: 10,
            precip: 161.7,
            max: 28.69,
            min: 25.45,
            absMax: 30.1,
            absMin: 23.8
        }, {
            month: 11,
            precip: 182.4,
            max: 28.34,
            min: 25.09,
            absMax: 30.1,
            absMin: 23.7
        }],
        2006: [{
            month: 0,
            precip: 132.1,
            max: 28.23,
            min: 24.03,
            absMax: 29.4,
            absMin: 23.2
        }, {
            month: 1,
            precip: 106.6,
            max: 28.34,
            min: 25.46,
            absMax: 30.1,
            absMin: 23.4
        }, {
            month: 2,
            precip: 95.8,
            max: 28.92,
            min: 25.6,
            absMax: 31.5,
            absMin: 23.8
        }, {
            month: 3,
            precip: 197.8,
            max: 28.62,
            min: 25.14,
            absMax: 30.6,
            absMin: 23.3
        }, {
            month: 4,
            precip: 172.2,
            max: 29.11,
            min: 25.46,
            absMax: 30.6,
            absMin: 24.1
        }, {
            month: 5,
            precip: 247.4,
            max: 28.43,
            min: 25.68,
            absMax: 29.8,
            absMin: 25.2
        }, {
            month: 6,
            precip: 149.3,
            max: 28.49,
            min: 26.21,
            absMax: 29.9,
            absMin: 25.2
        }, {
            month: 7,
            precip: 286.8,
            max: 28.61,
            min: 26.04,
            absMax: 30.4,
            absMin: 24.9
        }, {
            month: 8,
            precip: 226.5,
            max: 28.53,
            min: 25.31,
            absMax: 29.7,
            absMin: 24.3
        }, {
            month: 9,
            precip: 227.7,
            max: 28.7,
            min: 25.39,
            absMax: 30.1,
            absMin: 24.4
        }, {
            month: 10,
            precip: 169.1,
            max: 28.37,
            min: 25.24,
            absMax: 29.6,
            absMin: 24.1
        }, {
            month: 11,
            precip: 156.4,
            max: 27.88,
            min: 24.67,
            absMax: 29.2,
            absMin: 23.2
        }],
        2007: [{
            month: 0,
            precip: 155.8,
            max: 28.55,
            min: 24.39,
            absMax: 29.7,
            absMin: 23.1
        }, {
            month: 1,
            precip: 134.3,
            max: 28.06,
            min: 24.7,
            absMax: 29.3,
            absMin: 23.2
        }, {
            month: 2,
            precip: 150.2,
            max: 28.37,
            min: 25.11,
            absMax: 29.5,
            absMin: 23.5
        }, {
            month: 3,
            precip: 144,
            max: 28.95,
            min: 25.4,
            absMax: 30.3,
            absMin: 24.2
        }, {
            month: 4,
            precip: 165.9,
            max: 28.88,
            min: 25.77,
            absMax: 30,
            absMin: 24.4
        }, {
            month: 5,
            precip: 270.5,
            max: 28.55,
            min: 25.82,
            absMax: 29.8,
            absMin: 24.7
        }, {
            month: 6,
            precip: 224.2,
            max: 28.7,
            min: 26.51,
            absMax: 30,
            absMin: 25.4
        }, {
            month: 7,
            precip: 258.1,
            max: 29.16,
            min: 26.37,
            absMax: 30.5,
            absMin: 25.4
        }, {
            month: 8,
            precip: 234,
            max: 29.05,
            min: 25.77,
            absMax: 30.4,
            absMin: 24.7
        }, {
            month: 9,
            precip: 197.7,
            max: 29.44,
            min: 25.75,
            absMax: 31.2,
            absMin: 24.8
        }, {
            month: 10,
            precip: 187.2,
            max: 28.75,
            min: 25.6,
            absMax: 29.9,
            absMin: 24.6
        }, {
            month: 11,
            precip: 180.1,
            max: 28.4,
            min: 25.08,
            absMax: 30.4,
            absMin: 23.7
        }],
        2008: [{
            month: 0,
            precip: 133.5,
            max: 28.29,
            min: 24.1,
            absMax: 29.7,
            absMin: 23.2
        }, {
            month: 1,
            precip: 156.3,
            max: 28.45,
            min: 24.53,
            absMax: 30.2,
            absMin: 23.1
        }, {
            month: 2,
            precip: 132.2,
            max: 28.35,
            min: 25.03,
            absMax: 29.6,
            absMin: 23.7
        }, {
            month: 3,
            precip: 187.5,
            max: 28.92,
            min: 25.38,
            absMax: 30.5,
            absMin: 24.3
        }, {
            month: 4,
            precip: 206.6,
            max: 29.35,
            min: 25.69,
            absMax: 30.7,
            absMin: 24.7
        }, {
            month: 5,
            precip: 305.1,
            max: 28.77,
            min: 25.97,
            absMax: 30.1,
            absMin: 24.8
        }, {
            month: 6,
            precip: 262.4,
            max: 29.29,
            min: 26.53,
            absMax: 30.7,
            absMin: 25.8
        }, {
            month: 7,
            precip: 196.4,
            max: 29.6,
            min: 26.51,
            absMax: 31,
            absMin: 25.4
        }, {
            month: 8,
            precip: 193,
            max: 29.31,
            min: 26,
            absMax: 30.5,
            absMin: 24.8
        }, {
            month: 9,
            precip: 219.8,
            max: 29.54,
            min: 25.73,
            absMax: 30.8,
            absMin: 24.4
        }, {
            month: 10,
            precip: 181.5,
            max: 28.73,
            min: 25.53,
            absMax: 30,
            absMin: 24.5
        }, {
            month: 11,
            precip: 186,
            max: 28.73,
            min: 25.26,
            absMax: 30.5,
            absMin: 23.9
        }],
        2009: [{
            month: 0,
            precip: 119.2,
            max: 28.4,
            min: 24.4,
            absMax: 29.9,
            absMin: 23.2
        }, {
            month: 1,
            precip: 154.8,
            max: 27.94,
            min: 24.45,
            absMax: 29.3,
            absMin: 22.9
        }, {
            month: 2,
            precip: 178.1,
            max: 28.4,
            min: 24.88,
            absMax: 29.6,
            absMin: 23.4
        }, {
            month: 3,
            precip: 183,
            max: 28.86,
            min: 25.34,
            absMax: 30.2,
            absMin: 24.1
        }, {
            month: 4,
            precip: 228.8,
            max: 29.25,
            min: 25.63,
            absMax: 30.6,
            absMin: 24.4
        }, {
            month: 5,
            precip: 298.1,
            max: 28.85,
            min: 26.16,
            absMax: 30.4,
            absMin: 25.1
        }, {
            month: 6,
            precip: 301.2,
            max: 29.45,
            min: 26.63,
            absMax: 30.8,
            absMin: 25.5
        }, {
            month: 7,
            precip: 278,
            max: 29.65,
            min: 26.59,
            absMax: 31,
            absMin: 25.2
        }, {
            month: 8,
            precip: 231.4,
            max: 29.47,
            min: 26.2,
            absMax: 30.8,
            absMin: 24.9
        }, {
            month: 9,
            precip: 222.3,
            max: 29.47,
            min: 25.88,
            absMax: 30.8,
            absMin: 24.7
        }, {
            month: 10,
            precip: 180.5,
            max: 28.85,
            min: 25.55,
            absMax: 30.1,
            absMin: 24.3
        }, {
            month: 11,
            precip: 195,
            max: 28.53,
            min: 25.24,
            absMax: 30.2,
            absMin: 23.9
        }],
        2010: [{
            month: 0,
            precip: 126.8,
            max: 28.15,
            min: 24.35,
            absMax: 29.7,
            absMin: 23.2
        }, {
            month: 1,
            precip: 159.2,
            max: 27.94,
            min: 24.2,
            absMax: 29.3,
            absMin: 22.8
        }, {
            month: 2,
            precip: 159.3,
            max: 28.59,
            min: 24.9,
            absMax: 30,
            absMin: 23.5
        }, {
            month: 3,
            precip: 148.7,
            max: 28.72,
            min: 25.32,
            absMax: 30.2,
            absMin: 24
        }, {
            month: 4,
            precip: 194.1,
            max: 29.24,
            min: 25.67,
            absMax: 30.6,
            absMin: 24.3
        }, {
            month: 5,
            precip: 296,
            max: 28.71,
            min: 26.1,
            absMax: 30.4,
            absMin: 25
        }, {
            month: 6,
            precip: 301.7,
            max: 29.21,
            min: 26.33,
            absMax: 30.6,
            absMin: 25.4
        }, {
            month: 7,
            precip: 241.3,
            max: 29.38,
            min: 26.3,
            absMax: 31,
            absMin: 25.1
        }, {
            month: 8,
            precip: 250.5,
            max: 29.26,
            min: 25.92,
            absMax: 30.6,
            absMin: 24.7
        }, {
            month: 9,
            precip: 247.9,
            max: 29.39,
            min: 25.71,
            absMax: 30.7,
            absMin: 24.4
        }, {
            month: 10,
            precip: 201.7,
            max: 28.72,
            min: 25.48,
            absMax: 30.2,
            absMin: 24.2
        }, {
            month: 11,
            precip: 157.1,
            max: 28.41,
            min: 25.11,
            absMax: 30.3,
            absMin: 23.8
        }],
        2011: [{
            month: 0,
            precip: 122.3,
            max: 28.34,
            min: 24.45,
            absMax: 29.7,
            absMin: 23.3
        }, {
            month: 1,
            precip: 137.9,
            max: 27.83,
            min: 24.12,
            absMax: 29.1,
            absMin: 22.8
        }, {
            month: 2,
            precip: 201.9,
            max: 28.23,
            min: 24.6,
            absMax: 29.4,
            absMin: 23.4
        }, {
            month: 3,
            precip: 145.2,
            max: 28.88,
            min: 25.37,
            absMax: 30.2,
            absMin: 24.2
        }, {
            month: 4,
            precip: 214.5,
            max: 28.98,
            min: 25.53,
            absMax: 30.2,
            absMin: 24.4
        }, {
            month: 5,
            precip: 300.6,
            max: 28.68,
            min: 25.87,
            absMax: 30.1,
            absMin: 24.8
        }, {
            month: 6,
            precip: 287.1,
            max: 28.87,
            min: 26.19,
            absMax: 30.3,
            absMin: 25.3
        }, {
            month: 7,
            precip: 299,
            max: 29.2,
            min: 26.14,
            absMax: 30.5,
            absMin: 25.1
        }, {
            month: 8,
            precip: 240.4,
            max: 29.07,
            min: 25.8,
            absMax: 30.3,
            absMin: 24.4
        }, {
            month: 9,
            precip: 263,
            max: 29.35,
            min: 25.73,
            absMax: 30.7,
            absMin: 24.5
        }, {
            month: 10,
            precip: 207.6,
            max: 28.67,
            min: 25.43,
            absMax: 29.9,
            absMin: 24.2
        }, {
            month: 11,
            precip: 172.8,
            max: 28.63,
            min: 25.31,
            absMax: 30.2,
            absMin: 24
        }],
        2012: [{
            month: 0,
            precip: 148.7,
            max: 28.3,
            min: 24.18,
            absMax: 29.8,
            absMin: 23.1
        }, {
            month: 1,
            precip: 147.8,
            max: 28.29,
            min: 24.55,
            absMax: 29.9,
            absMin: 23.3
        }, {
            month: 2,
            precip: 175.3,
            max: 28.42,
            min: 24.92,
            absMax: 29.7,
            absMin: 23.6
        }, {
            month: 3,
            precip: 132.8,
            max: 28.95,
            min: 25.4,
            absMax: 30.3,
            absMin: 24.2
        }, {
            month: 4,
            precip: 197.6,
            max: 29.27,
            min: 25.62,
            absMax: 30.7,
            absMin: 24.5
        }, {
            month: 5,
            precip: 279.9,
            max: 28.79,
            min: 25.99,
            absMax: 30.2,
            absMin: 24.8
        }, {
            month: 6,
            precip: 289,
            max: 29.17,
            min: 26.38,
            absMax: 30.5,
            absMin: 25.4
        }, {
            month: 7,
            precip: 234.4,
            max: 29.37,
            min: 26.35,
            absMax: 30.9,
            absMin: 25.3
        }, {
            month: 8,
            precip: 208.5,
            max: 29.34,
            min: 26.04,
            absMax: 30.6,
            absMin: 24.8
        }, {
            month: 9,
            precip: 199,
            max: 29.57,
            min: 25.8,
            absMax: 31,
            absMin: 24.6
        }, {
            month: 10,
            precip: 195.8,
            max: 28.87,
            min: 25.58,
            absMax: 30.3,
            absMin: 24.4
        }, {
            month: 11,
            precip: 149.2,
            max: 28.56,
            min: 25.2,
            absMax: 30.1,
            absMin: 23.8
        }],
        2013: [{
            month: 0,
            precip: 118.8,
            max: 28.44,
            min: 24.28,
            absMax: 29.7,
            absMin: 23.1
        }, {
            month: 1,
            precip: 164.9,
            max: 27.89,
            min: 24.11,
            absMax: 29.2,
            absMin: 22.7
        }, {
            month: 2,
            precip: 149.3,
            max: 28.34,
            min: 24.73,
            absMax: 29.5,
            absMin: 23.4
        }, {
            month: 3,
            precip: 173.4,
            max: 28.85,
            min: 25.25,
            absMax: 30.2,
            absMin: 24.1
        }, {
            month: 4,
            precip: 191.4,
            max: 29.27,
            min: 25.75,
            absMax: 30.6,
            absMin: 24.6
        }, {
            month: 5,
            precip: 317.6,
            max: 28.75,
            min: 26.05,
            absMax: 30.2,
            absMin: 25.1
        }, {
            month: 6,
            precip: 263.9,
            max: 29.22,
            min: 26.47,
            absMax: 30.8,
            absMin: 25.5
        }, {
            month: 7,
            precip: 278.2,
            max: 29.59,
            min: 26.5,
            absMax: 31,
            absMin: 25.4
        }, {
            month: 8,
            precip: 196.5,
            max: 29.34,
            min: 26.09,
            absMax: 30.6,
            absMin: 24.8
        }, {
            month: 9,
            precip: 211.8,
            max: 29.45,
            min: 25.8,
            absMax: 30.8,
            absMin: 24.5
        }, {
            month: 10,
            precip: 182.1,
            max: 28.73,
            min: 25.5,
            absMax: 30,
            absMin: 24.3
        }, {
            month: 11,
            precip: 192.1,
            max: 28.7,
            min: 25.32,
            absMax: 30.3,
            absMin: 23.8
        }],
        2014: [{
            month: 0,
            precip: 129,
            max: 28.35,
            min: 24.23,
            absMax: 29.6,
            absMin: 23
        }, {
            month: 1,
            precip: 151.6,
            max: 28.02,
            min: 24.37,
            absMax: 29.4,
            absMin: 23.1
        }, {
            month: 2,
            precip: 127.5,
            max: 28.31,
            min: 24.8,
            absMax: 29.6,
            absMin: 23.5
        }, {
            month: 3,
            precip: 160.6,
            max: 28.86,
            min: 25.33,
            absMax: 30.2,
            absMin: 24.1
        }, {
            month: 4,
            precip: 214.8,
            max: 29.12,
            min: 25.67,
            absMax: 30.5,
            absMin: 24.4
        }, {
            month: 5,
            precip: 318.2,
            max: 28.72,
            min: 26.08,
            absMax: 30.2,
            absMin: 25
        }, {
            month: 6,
            precip: 256.8,
            max: 29.47,
            min: 26.54,
            absMax: 30.8,
            absMin: 25.6
        }, {
            month: 7,
            precip: 262,
            max: 29.53,
            min: 26.47,
            absMax: 31,
            absMin: 25.4
        }, {
            month: 8,
            precip: 219.3,
            max: 29.41,
            min: 26.15,
            absMax: 30.6,
            absMin: 25
        }, {
            month: 9,
            precip: 233.7,
            max: 29.51,
            min: 25.9,
            absMax: 31,
            absMin: 24.6
        }, {
            month: 10,
            precip: 177.5,
            max: 28.85,
            min: 25.62,
            absMax: 30.1,
            absMin: 24.5
        }, {
            month: 11,
            precip: 184.4,
            max: 28.64,
            min: 25.29,
            absMax: 30.1,
            absMin: 23.9
        }],
        2015: [{
            month: 0,
            precip: 127.6,
            max: 28.32,
            min: 24.3,
            absMax: 29.7,
            absMin: 23.1
        }, {
            month: 1,
            precip: 150.2,
            max: 27.82,
            min: 24.16,
            absMax: 29,
            absMin: 22.8
        }, {
            month: 2,
            precip: 167,
            max: 28.35,
            min: 24.78,
            absMax: 29.6,
            absMin: 23.4
        }, {
            month: 3,
            precip: 180.2,
            max: 28.76,
            min: 25.27,
            absMax: 30,
            absMin: 24
        }, {
            month: 4,
            precip: 217.1,
            max: 29.21,
            min: 25.65,
            absMax: 30.5,
            absMin: 24.4
        }, {
            month: 5,
            precip: 297.5,
            max: 28.78,
            min: 26.1,
            absMax: 30.2,
            absMin: 25.2
        }, {
            month: 6,
            precip: 283.5,
            max: 29.39,
            min: 26.5,
            absMax: 30.8,
            absMin: 25.6
        }, {
            month: 7,
            precip: 270.6,
            max: 29.5,
            min: 26.44,
            absMax: 30.9,
            absMin: 25.3
        }, {
            month: 8,
            precip: 231.2,
            max: 29.33,
            min: 26.05,
            absMax: 30.5,
            absMin: 24.9
        }, {
            month: 9,
            precip: 242,
            max: 29.41,
            min: 25.85,
            absMax: 30.8,
            absMin: 24.5
        }, {
            month: 10,
            precip: 185.9,
            max: 28.8,
            min: 25.58,
            absMax: 30,
            absMin: 24.4
        }, {
            month: 11,
            precip: 156.6,
            max: 28.63,
            min: 25.23,
            absMax: 30.2,
            absMin: 23.7
        }],
        2016: [{
            month: 0,
            precip: 173,
            max: 28.48,
            min: 25.03,
            absMax: 29.5,
            absMin: 23.9
        }, {
            month: 1,
            precip: 160.6,
            max: 29.14,
            min: 25.85,
            absMax: 31.4,
            absMin: 23.2
        }, {
            month: 2,
            precip: 151.2,
            max: 29.81,
            min: 25.7,
            absMax: 31.8,
            absMin: 23
        }, {
            month: 3,
            precip: 142.8,
            max: 29.63,
            min: 25.52,
            absMax: 31.4,
            absMin: 23.4
        }, {
            month: 4,
            precip: 137.4,
            max: 29.84,
            min: 25.53,
            absMax: 31.2,
            absMin: 23.5
        }, {
            month: 5,
            precip: 183.5,
            max: 30.36,
            min: 25.87,
            absMax: 32.2,
            absMin: 23.2
        }, {
            month: 6,
            precip: 201.8,
            max: 30.35,
            min: 25.96,
            absMax: 32.2,
            absMin: 23.6
        }, {
            month: 7,
            precip: 189.3,
            max: 30.42,
            min: 26.15,
            absMax: 32.5,
            absMin: 24
        }, {
            month: 8,
            precip: 241.4,
            max: 30.15,
            min: 25.73,
            absMax: 31.6,
            absMin: 23
        }, {
            month: 9,
            precip: 227.6,
            max: 29.92,
            min: 25.69,
            absMax: 31.4,
            absMin: 23.5
        }, {
            month: 10,
            precip: 179.2,
            max: 29.35,
            min: 25.35,
            absMax: 31.5,
            absMin: 23.2
        }, {
            month: 11,
            precip: 163.8,
            max: 28.65,
            min: 24.77,
            absMax: 30.2,
            absMin: 22
        }],
        2017: [{
            month: 0,
            precip: 152.3,
            max: 28.89,
            min: 24.56,
            absMax: 30.4,
            absMin: 22.1
        }, {
            month: 1,
            precip: 131.7,
            max: 29.52,
            min: 24.62,
            absMax: 31.2,
            absMin: 22.3
        }, {
            month: 2,
            precip: 161.9,
            max: 30.37,
            min: 24.97,
            absMax: 32.3,
            absMin: 22.4
        }, {
            month: 3,
            precip: 153.2,
            max: 30.35,
            min: 25.39,
            absMax: 31.6,
            absMin: 23.1
        }, {
            month: 4,
            precip: 186.8,
            max: 30.45,
            min: 25.43,
            absMax: 31.8,
            absMin: 23.6
        }, {
            month: 5,
            precip: 217.3,
            max: 30.97,
            min: 25.86,
            absMax: 32.5,
            absMin: 24
        }, {
            month: 6,
            precip: 204.5,
            max: 31,
            min: 26.19,
            absMax: 32.6,
            absMin: 24.4
        }, {
            month: 7,
            precip: 227.8,
            max: 31.16,
            min: 26.35,
            absMax: 33.5,
            absMin: 24.6
        }, {
            month: 8,
            precip: 289.3,
            max: 31.16,
            min: 26,
            absMax: 33.8,
            absMin: 23.7
        }, {
            month: 9,
            precip: 259.4,
            max: 30.94,
            min: 25.7,
            absMax: 32.7,
            absMin: 23.4
        }, {
            month: 10,
            precip: 211.5,
            max: 30.13,
            min: 25.42,
            absMax: 31.8,
            absMin: 22.8
        }, {
            month: 11,
            precip: 183.6,
            max: 29.27,
            min: 24.98,
            absMax: 31,
            absMin: 22.5
        }],
        2018: [{
            month: 0,
            precip: 148.7,
            max: 29.23,
            min: 24.45,
            absMax: 31,
            absMin: 22.2
        }, {
            month: 1,
            precip: 132.4,
            max: 29.65,
            min: 24.42,
            absMax: 31.1,
            absMin: 22
        }, {
            month: 2,
            precip: 156.8,
            max: 30.16,
            min: 24.72,
            absMax: 31.4,
            absMin: 22.2
        }, {
            month: 3,
            precip: 164.2,
            max: 29.91,
            min: 24.99,
            absMax: 31,
            absMin: 22.8
        }, {
            month: 4,
            precip: 197.3,
            max: 30.27,
            min: 25.34,
            absMax: 31.2,
            absMin: 23.4
        }, {
            month: 5,
            precip: 212.6,
            max: 30.48,
            min: 25.63,
            absMax: 31.3,
            absMin: 23.8
        }, {
            month: 6,
            precip: 198.4,
            max: 30.26,
            min: 25.7,
            absMax: 31.5,
            absMin: 23.9
        }, {
            month: 7,
            precip: 216.8,
            max: 30.76,
            min: 26.02,
            absMax: 32.2,
            absMin: 24.2
        }, {
            month: 8,
            precip: 265.3,
            max: 30.52,
            min: 25.53,
            absMax: 31.9,
            absMin: 23.2
        }, {
            month: 9,
            precip: 237.7,
            max: 30.45,
            min: 25.45,
            absMax: 31.8,
            absMin: 23.1
        }, {
            month: 10,
            precip: 189.2,
            max: 29.78,
            min: 25.15,
            absMax: 31.5,
            absMin: 22.6
        }, {
            month: 11,
            precip: 164.5,
            max: 29.03,
            min: 24.7,
            absMax: 31,
            absMin: 21.8
        }],
        2019: [{
            month: 0,
            precip: 146.3,
            max: 29.13,
            min: 24.49,
            absMax: 30.6,
            absMin: 22.4
        }, {
            month: 1,
            precip: 128.9,
            max: 29.44,
            min: 24.38,
            absMax: 31,
            absMin: 22.2
        }, {
            month: 2,
            precip: 152.7,
            max: 30.03,
            min: 24.64,
            absMax: 31.2,
            absMin: 22.2
        }, {
            month: 3,
            precip: 168.4,
            max: 30.15,
            min: 25.19,
            absMax: 31.4,
            absMin: 23.2
        }, {
            month: 4,
            precip: 191.2,
            max: 30.34,
            min: 25.36,
            absMax: 31.5,
            absMin: 23.6
        }, {
            month: 5,
            precip: 218.9,
            max: 30.65,
            min: 25.69,
            absMax: 31.6,
            absMin: 24
        }, {
            month: 6,
            precip: 209.3,
            max: 30.58,
            min: 25.99,
            absMax: 31.8,
            absMin: 24.3
        }, {
            month: 7,
            precip: 228.4,
            max: 31.05,
            min: 26.16,
            absMax: 32.7,
            absMin: 24.5
        }, {
            month: 8,
            precip: 271.6,
            max: 30.91,
            min: 25.68,
            absMax: 32.5,
            absMin: 23.5
        }, {
            month: 9,
            precip: 246.8,
            max: 30.69,
            min: 25.53,
            absMax: 32.2,
            absMin: 23.3
        }, {
            month: 10,
            precip: 198.3,
            max: 29.98,
            min: 25.18,
            absMax: 31.4,
            absMin: 22.6
        }, {
            month: 11,
            precip: 172.4,
            max: 29.15,
            min: 24.81,
            absMax: 31,
            absMin: 21.7
        }],
        2020: [{
            month: 0,
            precip: 149.6,
            max: 29.27,
            min: 24.51,
            absMax: 30.8,
            absMin: 22.3
        }, {
            month: 1,
            precip: 135.2,
            max: 29.54,
            min: 24.48,
            absMax: 31.1,
            absMin: 21.9
        }, {
            month: 2,
            precip: 151.8,
            max: 29.89,
            min: 24.61,
            absMax: 31,
            absMin: 22.1
        }, {
            month: 3,
            precip: 165.9,
            max: 29.8,
            min: 24.88,
            absMax: 30.8,
            absMin: 22.7
        }, {
            month: 4,
            precip: 193.7,
            max: 30.34,
            min: 25.33,
            absMax: 31.5,
            absMin: 23.5
        }, {
            month: 5,
            precip: 221.4,
            max: 30.68,
            min: 25.71,
            absMax: 31.8,
            absMin: 24.1
        }, {
            month: 6,
            precip: 204.8,
            max: 30.51,
            min: 25.85,
            absMax: 31.8,
            absMin: 24.2
        }, {
            month: 7,
            precip: 219.6,
            max: 30.82,
            min: 26.05,
            absMax: 32.3,
            absMin: 24.4
        }, {
            month: 8,
            precip: 268.2,
            max: 30.68,
            min: 25.62,
            absMax: 32.2,
            absMin: 23.2
        }, {
            month: 9,
            precip: 243.5,
            max: 30.52,
            min: 25.52,
            absMax: 31.9,
            absMin: 23.2
        }, {
            month: 10,
            precip: 195.7,
            max: 29.85,
            min: 25.2,
            absMax: 31.3,
            absMin: 22.5
        }, {
            month: 11,
            precip: 169.3,
            max: 29.08,
            min: 24.79,
            absMax: 31.2,
            absMin: 21.6
        }],
        2021: [{
            month: 0,
            precip: 147.2,
            max: 29.35,
            min: 24.53,
            absMax: 31,
            absMin: 22.3
        }, {
            month: 1,
            precip: 130.8,
            max: 29.52,
            min: 24.45,
            absMax: 31.1,
            absMin: 22
        }, {
            month: 2,
            precip: 155.3,
            max: 30.21,
            min: 24.76,
            absMax: 31.5,
            absMin: 22.3
        }, {
            month: 3,
            precip: 169.7,
            max: 30.26,
            min: 25.28,
            absMax: 31.6,
            absMin: 23.2
        }, {
            month: 4,
            precip: 196.4,
            max: 30.48,
            min: 25.47,
            absMax: 31.8,
            absMin: 23.7
        }, {
            month: 5,
            precip: 223.8,
            max: 30.72,
            min: 25.82,
            absMax: 31.9,
            absMin: 24.1
        }, {
            month: 6,
            precip: 211.6,
            max: 30.73,
            min: 26.12,
            absMax: 32.1,
            absMin: 24.5
        }, {
            month: 7,
            precip: 232.9,
            max: 31.12,
            min: 26.31,
            absMax: 33,
            absMin: 24.7
        }, {
            month: 8,
            precip: 285.4,
            max: 31.06,
            min: 25.87,
            absMax: 33.5,
            absMin: 23.8
        }, {
            month: 9,
            precip: 257.2,
            max: 30.81,
            min: 25.71,
            absMax: 32.5,
            absMin: 23.4
        }, {
            month: 10,
            precip: 207.3,
            max: 30.2,
            min: 25.38,
            absMax: 31.8,
            absMin: 22.7
        }, {
            month: 11,
            precip: 178.9,
            max: 29.38,
            min: 24.98,
            absMax: 31.2,
            absMin: 22.1
        }],
        2022: [{
            month: 0,
            precip: 151.4,
            max: 29.42,
            min: 24.62,
            absMax: 31,
            absMin: 22.2
        }, {
            month: 1,
            precip: 133.7,
            max: 29.61,
            min: 24.54,
            absMax: 31,
            absMin: 22
        }, {
            month: 2,
            precip: 158.6,
            max: 30.33,
            min: 24.92,
            absMax: 31.6,
            absMin: 22.4
        }, {
            month: 3,
            precip: 171.2,
            max: 30.31,
            min: 25.41,
            absMax: 31.7,
            absMin: 23.3
        }, {
            month: 4,
            precip: 198.9,
            max: 30.52,
            min: 25.58,
            absMax: 31.9,
            absMin: 23.7
        }, {
            month: 5,
            precip: 226.3,
            max: 30.84,
            min: 25.96,
            absMax: 32,
            absMin: 24.1
        }, {
            month: 6,
            precip: 215.8,
            max: 30.82,
            min: 26.22,
            absMax: 32.3,
            absMin: 24.6
        }, {
            month: 7,
            precip: 237.4,
            max: 31.25,
            min: 26.44,
            absMax: 33.1,
            absMin: 24.8
        }, {
            month: 8,
            precip: 292.7,
            max: 31.22,
            min: 26.04,
            absMax: 33.6,
            absMin: 23.9
        }, {
            month: 9,
            precip: 268.3,
            max: 31.04,
            min: 25.89,
            absMax: 32.7,
            absMin: 23.6
        }, {
            month: 10,
            precip: 214.8,
            max: 30.41,
            min: 25.55,
            absMax: 31.9,
            absMin: 22.8
        }, {
            month: 11,
            precip: 186.2,
            max: 29.62,
            min: 25.15,
            absMax: 31.4,
            absMin: 22.3
        }],
        2023: [{
            month: 0,
            precip: 152.8,
            max: 29.53,
            min: 24.72,
            absMax: 31,
            absMin: 22.4
        }, {
            month: 1,
            precip: 135.3,
            max: 29.73,
            min: 24.61,
            absMax: 31.1,
            absMin: 22.1
        }, {
            month: 2,
            precip: 160.2,
            max: 30.44,
            min: 24.99,
            absMax: 31.8,
            absMin: 22.5
        }, {
            month: 3,
            precip: 172.6,
            max: 30.42,
            min: 25.51,
            absMax: 31.8,
            absMin: 23.4
        }, {
            month: 4,
            precip: 200.7,
            max: 30.63,
            min: 25.69,
            absMax: 32,
            absMin: 23.8
        }, {
            month: 5,
            precip: 229.4,
            max: 30.97,
            min: 26.07,
            absMax: 32.1,
            absMin: 24.2
        }, {
            month: 6,
            precip: 219.6,
            max: 30.91,
            min: 26.33,
            absMax: 32.4,
            absMin: 24.7
        }, {
            month: 7,
            precip: 241.8,
            max: 31.38,
            min: 26.55,
            absMax: 33.7,
            absMin: 25
        }, {
            month: 8,
            precip: 298.2,
            max: 31.35,
            min: 26.15,
            absMax: 33.8,
            absMin: 24
        }, {
            month: 9,
            precip: 272.4,
            max: 31.23,
            min: 26,
            absMax: 32.9,
            absMin: 23.8
        }, {
            month: 10,
            precip: 221.6,
            max: 30.59,
            min: 25.71,
            absMax: 32.1,
            absMin: 23
        }, {
            month: 11,
            precip: 192.7,
            max: 29.79,
            min: 25.31,
            absMax: 31.6,
            absMin: 22.5
        }],
        2024: [{
            month: 0,
            precip: 156.3,
            max: 29.68,
            min: 24.83,
            absMax: 31.1,
            absMin: 22.5
        }, {
            month: 1,
            precip: 138.9,
            max: 29.86,
            min: 24.73,
            absMax: 31.2,
            absMin: 22.2
        }, {
            month: 2,
            precip: 163.8,
            max: 30.58,
            min: 25.11,
            absMax: 31.9,
            absMin: 22.6
        }, {
            month: 3,
            precip: 175.3,
            max: 30.58,
            min: 25.62,
            absMax: 32,
            absMin: 23.5
        }, {
            month: 4,
            precip: 203.5,
            max: 30.79,
            min: 25.8,
            absMax: 32.1,
            absMin: 23.9
        }, {
            month: 5,
            precip: 232.7,
            max: 31.13,
            min: 26.18,
            absMax: 32.3,
            absMin: 24.3
        }, {
            month: 6,
            precip: 223.4,
            max: 31.09,
            min: 26.44,
            absMax: 32.5,
            absMin: 24.8
        }, {
            month: 7,
            precip: 246.3,
            max: 31.52,
            min: 26.66,
            absMax: 33.6,
            absMin: 25.1
        }, {
            month: 8,
            precip: 304.6,
            max: 31.5,
            min: 26.26,
            absMax: 34,
            absMin: 24.1
        }, {
            month: 9,
            precip: 279.8,
            max: 31.42,
            min: 26.11,
            absMax: 32.9,
            absMin: 23.9
        }, {
            month: 10,
            precip: 228.4,
            max: 30.77,
            min: 25.82,
            absMax: 32.2,
            absMin: 23.1
        }, {
            month: 11,
            precip: 199.3,
            max: 29.94,
            min: 25.42,
            absMax: 31.8,
            absMin: 22.6
        }],
        2025: [{
            month: 0,
            precip: 158.7,
            max: 29.79,
            min: 24.94,
            absMax: 31.2,
            absMin: 22.6
        }, {
            month: 1,
            precip: 141.2,
            max: 29.97,
            min: 24.84,
            absMax: 31.3,
            absMin: 22.3
        }, {
            month: 2,
            precip: 166.4,
            max: 30.69,
            min: 25.22,
            absMax: 32,
            absMin: 22.7
        }, {
            month: 3,
            precip: 178.9,
            max: 30.69,
            min: 25.73,
            absMax: 32.1,
            absMin: 23.6
        }, {
            month: 4,
            precip: 206.8,
            max: 30.9,
            min: 25.91,
            absMax: 32.2,
            absMin: 24
        }, {
            month: 5,
            precip: 235.9,
            max: 31.24,
            min: 26.29,
            absMax: 32.4,
            absMin: 24.4
        }, {
            month: 6,
            precip: 226.7,
            max: 31.2,
            min: 26.55,
            absMax: 32.6,
            absMin: 24.9
        }, {
            month: 7,
            precip: 251.8,
            max: 31.67,
            min: 26.77,
            absMax: 33.7,
            absMin: 25.2
        }, {
            month: 8,
            precip: 310.3,
            max: 31.65,
            min: 26.37,
            absMax: 34.1,
            absMin: 24.2
        }, {
            month: 9,
            precip: 285.2,
            max: 31.53,
            min: 26.22,
            absMax: 33,
            absMin: 24
        }, {
            month: 10,
            precip: 235.7,
            max: 30.88,
            min: 25.93,
            absMax: 32.3,
            absMin: 23.2
        }, {
            month: 11,
            precip: 205.6,
            max: 30.05,
            min: 25.53,
            absMax: 31.9,
            absMin: 22.7
        }]
    },
    jo = null,
    qo = "true" === localStorage.getItem("isFahrenheit"),
    Zo = "true" === localStorage.getItem("isXtreme");
document.addEventListener("DOMContentLoaded", () => {
    Oo = new Go(document.getElementById("canvas-container"));
    const e = document.getElementById("search-btn"),
        n = document.getElementById("clear-btn"),
        i = document.getElementById("location-input"),
        a = document.getElementById("autocomplete-dropdown"),
        r = document.getElementById("autocomplete-list"),
        s = document.getElementById("theme-toggle"),
        o = document.getElementById("unit-toggle"),
        l = document.getElementById("extreme-toggle"),
        c = document.getElementById("go-to-focus-btn"),
        h = () => {
            const t = Oo.weather3D;
            t && (null !== t.focusedMonth || null !== t.focusedYearOffset ? (c.setAttribute("aria-label", "Go to focus"), c.setAttribute("title", "Go to focus [G]"), c.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21l20-9L2 3v7l15 2-15 2v7z"></path></svg>') : (c.setAttribute("aria-label", "Run demo flythrough"), c.setAttribute("title", "Run demo flythrough [R]"), c.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>'))
        };
    Oo.weather3D.onFocusChange = h, h(), c.addEventListener("click", () => {
        const t = Oo.weather3D;
        t && (null !== t.focusedMonth ? Oo.flyToMonth(t.focusedMonth) : null !== t.focusedYearOffset ? Oo.flyToYear(t.focusedYearOffset) : Oo.runFlythrough())
    }), document.getElementById("reset-camera-btn").addEventListener("click", () => Oo.resetCamera()), Oo.setupKeyboardMovement(() => document.activeElement === i);
    const u = document.getElementById("brand-badge"),
        d = document.getElementById("info-overlay"),
        p = document.getElementById("info-close-btn"),
        m = () => d.classList.add("active"),
        f = () => d.classList.remove("active");
    u.addEventListener("click", m), u.addEventListener("keydown", t => {
        "Enter" !== t.key && " " !== t.key || (t.preventDefault(), m())
    }), p.addEventListener("click", f), d.addEventListener("click", t => {
        t.target === d && f()
    });
    const g = document.getElementById("play-pause-btn"),
        _ = document.getElementById("prev-track-btn"),
        v = document.getElementById("next-track-btn"),
        x = document.getElementById("music-track-name"),
        M = document.getElementById("music-player"),
        b = document.getElementById("music-volume-slider"),
        y = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1,7 C3,1 8,1 10,7 C12,13 17,13 19,7"/></svg>',
        S = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="14" viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"><polyline points="1,11 6,3 6,11 11,3 11,11 16,3 16,11 19,11"/></svg>';
    Zo && (l.innerHTML = S), qo && (o.textContent = "°F");
    const E = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
        T = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>',
        w = [{
            file: "isobars.opus",
            name: "Isobars"
        }, {
            file: "continental.opus",
            name: "Continental Drifts"
        }, {
            file: "stratosphere.opus",
            name: "Stratosphere"
        }, {
            file: "seasonal.opus",
            name: "Seasonal Gradients"
        }, {
            file: "barometric.opus",
            name: "Barometric Echoes"
        }, {
            file: "pressure.opus",
            name: "Pressure Lines"
        }];
    let A = Math.floor(Math.random() * w.length),
        R = !1;
    const C = new Audio(w[A].file);
    C.volume = 0;
    let P = parseFloat(localStorage.getItem("userVolume") ?? "0.7");

    function D() {
        x.textContent = w[A].name
    }
    b.value = 100 * P, b.addEventListener("input", () => {
        P = b.value / 100, C.volume = R ? P : 0, localStorage.setItem("userVolume", P)
    }), D();
    const L = () => {
        const t = "Switch to Mean mode using monthly averages of highest and lowest daily temperatures [X]",
            e = "Switch to Xtreme mode using highest and lowest monthly temperatures [X]",
            n = "Switch temperature unit to Celsius [C]",
            i = "Switch temperature unit to Fahrenheit [F]",
            a = "Switch to Light mode [/]",
            r = "Switch to Dark mode [/]",
            c = "Pause music [Space]",
            h = "Play music [Space]",
            u = "Previous track [PageUp]",
            d = "Next track [PageDown]";
        Zo ? (l.setAttribute("aria-label", t), l.setAttribute("title", t)) : (l.setAttribute("aria-label", e), l.setAttribute("title", e)), qo ? (o.setAttribute("aria-label", n), o.setAttribute("title", n)) : (o.setAttribute("aria-label", i), o.setAttribute("title", i)), "dark" === document.documentElement.getAttribute("data-theme") ? (s.setAttribute("aria-label", a), s.setAttribute("title", a)) : (s.setAttribute("aria-label", r), s.setAttribute("title", r)), R ? (g.setAttribute("aria-label", c), g.setAttribute("title", c)) : (g.setAttribute("aria-label", h), g.setAttribute("title", h)), _.setAttribute("aria-label", u), _.setAttribute("title", u), v.setAttribute("aria-label", d), v.setAttribute("title", d)
    };
    L();
    {
        const ht = ["mousedown", "keydown", "touchend"];

        function ut(t) {
            ht.forEach(t => document.removeEventListener(t, ut));
            const e = "keydown" === t.type && " " === t.key,
                n = g.contains(t.target);
            e || n && ("touchend" === t.type || "mousedown" === t.type) || N()
        }
        ht.forEach(t => document.addEventListener(t, ut, {
            once: !1
        }))
    }
    let I;

    function U(t, e, n, i) {
        I && clearInterval(I);
        const a = n / 30,
            r = (e - t.volume) / 30;
        I = setInterval(() => {
            let n = t.volume + r;
            r > 0 && n >= e || r < 0 && n <= e ? (t.volume = e, clearInterval(I), I = null, i && i()) : t.volume = n
        }, a)
    }

    function N() {
        R || (R = !0, g.innerHTML = T, L(), M.classList.add("is-playing"), C.play().then(() => {
            U(C, P, 800)
        }).catch(t => {
            R = !1, g.innerHTML = E, L(), M.classList.remove("is-playing")
        }))
    }

    function O() {
        R && (R = !1, g.innerHTML = E, L(), M.classList.remove("is-playing"), U(C, 0, 800, () => {
            R || C.pause()
        }))
    }

    function F(t, e = !1) {
        if (I && clearInterval(I), !R) return A = t, C.src = w[A].file, C.volume = 0, void D();
        e ? (A = t, C.src = w[A].file, C.volume = 0, D(), C.play().then(() => {
            U(C, P, 1e3)
        }).catch(t => {
            R = !1, g.innerHTML = E, L(), M.classList.remove("is-playing")
        })) : U(C, 0, 600, () => {
            A = t, C.src = w[A].file, D(), C.play().then(() => {
                U(C, P, 1e3)
            }).catch(t => {
                R = !1, g.innerHTML = E, L(), M.classList.remove("is-playing")
            })
        })
    }
    C.addEventListener("ended", () => {
        F((A + 1) % w.length, !0)
    });
    let B = !1,
        z = 0,
        V = !1;

    function k() {
        R && (B = !0, g.innerHTML = E, M.classList.remove("is-playing"), U(C, 0, 800, () => {
            R && !B || C.pause()
        }))
    }

    function H() {
        B && (B = !1, z = Date.now(), g.innerHTML = T, M.classList.add("is-playing"), C.play().then(() => {
            U(C, P, 1800)
        }).catch(() => {}))
    }
    document.addEventListener("visibilitychange", () => {
        document.hidden ? k() : H()
    }), window.addEventListener("blur", k), window.addEventListener("focus", H);
    const G = () => {
        Date.now() - z < 250 && (V = !0)
    };
    g.addEventListener("mousedown", G), g.addEventListener("touchstart", G, {
        passive: !0
    }), g.addEventListener("click", () => {
        V ? V = !1 : R ? O() : N()
    }), _.addEventListener("click", () => {
        F((A - 1 + w.length) % w.length)
    }), v.addEventListener("click", () => {
        F((A + 1) % w.length)
    }), document.addEventListener("keydown", t => {
        if (document.activeElement === i) return;
        const e = Oo.weather3D,
            n = e.numYears;
        switch (t.key) {
            case "ArrowUp":
                if (t.preventDefault(), 0 === n) break;
                null === e.focusedYearOffset ? e.setFocus(n - 1) : e.setFocus(0 === e.focusedYearOffset ? n - 1 : e.focusedYearOffset - 1);
                break;
            case "ArrowDown":
                if (t.preventDefault(), 0 === n) break;
                null === e.focusedYearOffset ? e.setFocus(0) : e.setFocus(e.focusedYearOffset === n - 1 ? 0 : e.focusedYearOffset + 1);
                break;
            case "ArrowLeft":
                t.preventDefault(), null === e.focusedMonth ? e.setMonthFocus(11) : e.setMonthFocus(0 === e.focusedMonth ? 11 : e.focusedMonth - 1);
                break;
            case "ArrowRight":
                t.preventDefault(), null === e.focusedMonth ? e.setMonthFocus(0) : e.setMonthFocus(11 === e.focusedMonth ? 0 : e.focusedMonth + 1);
                break;
            case "PageUp":
                t.preventDefault(), F((A - 1 + w.length) % w.length);
                break;
            case "PageDown":
                t.preventDefault(), F((A + 1) % w.length);
                break;
            case " ":
                t.preventDefault(), R ? O() : N();
                break;
            case "Enter":
                t.preventDefault(), Oo.resetCamera();
                break;
            case "Escape":
                d.classList.contains("active") ? f() : e.clearFocus();
                break;
            case "c":
            case "C":
                qo && (qo = !1, o.textContent = "°C", localStorage.setItem("isFahrenheit", qo), L(), jo && Oo.weather3D.updateUnit(qo));
                break;
            case "f":
            case "F":
                qo || (qo = !0, o.textContent = "°F", localStorage.setItem("isFahrenheit", qo), L(), jo && Oo.weather3D.updateUnit(qo));
                break;
            case "x":
            case "X":
                Zo = !Zo, l.innerHTML = Zo ? S : y, localStorage.setItem("isXtreme", Zo), L(), jo && Oo.weather3D.transitionTo(jo, qo, Zo);
                break;
            case "/":
                break;
            case "?":
                t.preventDefault(), d.classList.contains("active") ? f() : m();
                break;
            case "g":
            case "G":
                null !== e.focusedMonth ? Oo.flyToMonth(e.focusedMonth) : null !== e.focusedYearOffset ? Oo.flyToYear(e.focusedYearOffset) : Oo.runFlythrough();
                break;
            case "r":
            case "R":
                t.preventDefault(), Oo.runFlythrough();
                break;
            case "y":
            case "Y":
                n > 0 && (e.setFocus(n - 1), Oo.flyToYear(n - 1));
                break;
            case "m":
            case "M":
                n > 0 && (e.setMonthFocus(0), Oo.flyToMonth(0));
                break;
            default: {
                const i = {
                    1: 0,
                    2: 1,
                    3: 2,
                    4: 3,
                    5: 4,
                    6: 5,
                    7: 6,
                    8: 7,
                    9: 8,
                    0: 9,
                    "-": 10,
                    "=": 11
                };
                if (t.key in i && n > 0) {
                    const n = i[t.key];
                    e.setMonthFocus(n), Oo.flyToMonth(n)
                }
                break
            }
        }
    }), document.addEventListener("keydown", t => {
        switch (t.key) {
            case "MediaPlayPause":
                t.preventDefault(), R ? O() : N();
                break;
            case "MediaTrackPrevious":
                t.preventDefault(), F((A - 1 + w.length) % w.length);
                break;
            case "MediaTrackNext":
                t.preventDefault(), F((A + 1) % w.length)
        }
    });
    const W = document.getElementById("fetch-overlay"),
        X = document.getElementById("fetch-status"),
        Y = document.getElementById("fetch-error-container"),
        j = document.getElementById("fetch-error-msg"),
        q = document.getElementById("dialog-close-btn"),
        Z = document.getElementById("fetch-progress-bar"),
        K = document.getElementById("location-name"),
        J = document.getElementById("location-address");
    n.addEventListener("click", () => {
        i.value = "", n.classList.add("hidden"), a.classList.add("hidden"), i.focus()
    }), q.addEventListener("click", () => {
        W.classList.remove("active")
    }), e.addEventListener("click", () => {
        a.classList.add("hidden"), at(i.value)
    }), i.addEventListener("keypress", t => {
        "Enter" === t.key && (a.classList.add("hidden"), at(i.value))
    });
    let $ = [];
    const Q = () => {
        i.value.length > 0 ? n.classList.remove("hidden") : n.classList.add("hidden")
    };
    let tt;
    i.addEventListener("input", e => {
        Q(), 0 === e.target.value.length && ($ = []), clearTimeout(tt), tt = setTimeout(() => async function(e) {
            if (e.trim().length < 2) return a.classList.add("hidden"), void($ = []);
            const n = await t.getSuggestions(e);
            if ($ = n, 0 === n.length) return void a.classList.add("hidden");
            r.innerHTML = "", n.forEach((t, e) => {
                const n = document.createElement("div");
                n.className = "autocomplete-item" + (0 === e ? " active" : ""), n.textContent = t.fullAddress, n.addEventListener("click", async () => {
                    i.value = t.name, Q(), a.classList.add("hidden"), $ = [], await it(t.lat, t.lon, t.name, t.fullAddress)
                }), r.appendChild(n)
            }), a.classList.remove("hidden")
        }(e.target.value), 300)
    }), document.addEventListener("click", t => {
        t.target.closest("#search-wrapper") || a.classList.add("hidden")
    });
    const et = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
        nt = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    async function it(e, n, i, a) {
        Y.classList.add("hidden"), Z.style.width = "0%", X.textContent = `Fetching data for ${i}...`, W.classList.add("active");
        try {
            let s;
            try {
                s = await t.getHistoricalData(e, n, t => {
                    Z.style.width = `${t}%`, X.textContent = `Fetching data for ${i}... ${t}%`
                })
            } catch (r) {
                let t, e = "Fetching Failed";
                return navigator.onLine ? r.message.toLowerCase().includes("rate limit") ? e = "Rate Limit Exceeded" : "TypeError" === r.name && (e = "Connection Error") : e = "Network Offline", X.textContent = e, t = navigator.onLine ? r.message.toLowerCase().includes("rate limit") ? "The weather API rate limit has been reached. Please wait a while before retrying." : "TypeError" === r.name ? "Could not connect to the weather service. Check your network and try again." : `Unable to fetch data for ${i}. You may try again shortly.` : "You appear to be offline. Check your connection and try again.", j.textContent = t, void Y.classList.remove("hidden")
            }
            if (s !== Yo) {
                K.classList.add("fade-out"), J.classList.add("fade-out"), W.classList.remove("active"), await new Promise(t => setTimeout(t, 400)), Oo.weather3D.fadeOut(1e3), await Oo.resetCamera({
                    animate: !0,
                    duration: 1500
                }), K.textContent = i, J.textContent = a || "";
                const t = new URL(window.location);
                t.searchParams.set("lat", e), t.searchParams.set("lon", n), t.searchParams.set("name", i), window.history.replaceState({}, "", t), jo = s, Oo.renderWeather(s, qo, !0, Zo), requestAnimationFrame(() => {
                    const t = document.getElementById("initial-loader");
                    t && !t.classList.contains("hidden") || (K.classList.remove("fade-out"), J.classList.remove("fade-out"))
                })
            } else jo = s, Oo.renderWeather(s, qo, !1, Zo), requestAnimationFrame(() => {
                const t = document.getElementById("initial-loader");
                t && !t.classList.contains("hidden") || (K.classList.remove("fade-out"), J.classList.remove("fade-out"))
            })
        } catch (s) {
            X.textContent = "Error", j.textContent = s.message || "Error fetching data. Please try again.", Y.classList.remove("hidden")
        }
    }
    async function at(t) {
        if (t.trim() && $.length > 0) {
            const t = $[0];
            return a.classList.add("hidden"), i.value = t.name, Q(), $ = [], void(await it(t.lat, t.lon, t.name, t.fullAddress))
        }
    }

    function rt() {
        const t = document.getElementById("initial-loader");
        t && !t.classList.contains("hidden") ? (t.style.opacity = "0", setTimeout(() => {
            t.style.display = "none", t.classList.add("hidden"), requestAnimationFrame(() => {
                K.classList.remove("fade-out"), J.classList.remove("fade-out")
            })
        }, 600)) : (K.classList.remove("fade-out"), J.classList.remove("fade-out"))
    }
    s.classList.add("hidden"), s.innerHTML = "dark" === document.documentElement.getAttribute("data-theme") ? nt : et, s.addEventListener("click", () => {
        const t = "dark" === document.documentElement.getAttribute("data-theme"),
            e = t ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", e), s.innerHTML = t ? et : nt, localStorage.setItem("theme", e), L(), jo && Oo.renderWeather(jo, qo, !0, Zo)
    }), o.addEventListener("click", () => {
        qo = !qo, o.textContent = qo ? "°F" : "°C", localStorage.setItem("isFahrenheit", qo), L(), jo && Oo.weather3D.updateUnit(qo)
    }), l.addEventListener("click", () => {
        Zo = !Zo, l.innerHTML = Zo ? S : y, localStorage.setItem("isXtreme", Zo), L(), jo && Oo.weather3D.transitionTo(jo, qo, Zo)
    });
    const st = new URLSearchParams(window.location.search),
        ot = st.get("lat"),
        lt = st.get("lon"),
        ct = st.get("name");
    ot && lt ? (Q(), (async () => {
        let e = ct,
            n = "";
        if (!e) {
            const a = `${parseFloat(ot).toFixed(4)}, ${parseFloat(lt).toFixed(4)}`;
            i.value = a, Q(), K.textContent = a;
            const r = await t.getReverseLookup(ot, lt);
            e = r.name, n = r.fullAddress
        }
        i.value = e, Q(), K.textContent = e, J.textContent = n, await it(ot, lt, e, n), rt()
    })()) : (i.value = Wo, Q(), jo = Yo, K.textContent = `${Wo} (Sample)`, J.textContent = Xo, Oo.renderWeather(Yo, qo, !1, Zo), rt())
});