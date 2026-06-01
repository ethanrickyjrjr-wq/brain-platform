import anthropic


def summarize_notice(pdf_text: str, model: str = 'claude-sonnet-4-6') -> str:
    """Generate a 2-3 sentence plain-English summary of a DBPR notice.

    Returns the summary string. On API error, returns empty string (caller logs, row still upserts).
    """
    client = anthropic.Anthropic()
    prompt = (
        "Summarize this DBPR enforcement notice in 2-3 plain English sentences. "
        "Include: who is named, what practice is at issue, and the response deadline. "
        "Do not use legal jargon. Do not add commentary or opinion.\n\n"
        f"{pdf_text[:3000]}"
    )
    try:
        msg = client.messages.create(
            model=model,
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip()
    except Exception as e:
        print(f"[summarize] Claude API error: {e}")
        return ''
