def looks_like_academic_batch_name(value: str | None) -> bool:
    normalized = (value or "").strip().lower()
    if not normalized:
        return False

    coaching_keywords = [
        "med",
        "medical",
        "non med",
        "non medical",
        "newton",
        "aiims",
        "neet",
        "jee",
        "advance",
        "adv",
        "ssb",
        "sure selection",
        "dropper",
        "pcm",
        "pcb",
        "batch",
    ]
    return any(keyword in normalized for keyword in coaching_keywords)


def split_batch_to_class_section(batch_name: str | None) -> tuple[str | None, str | None]:
    normalized = (batch_name or "").strip()
    if not normalized:
        return None, None

    if "|" in normalized:
        class_part, section_part = normalized.split("|", 1)
        return class_part.strip() or None, section_part.strip() or None

    if looks_like_academic_batch_name(normalized):
        return None, None

    simple_class_match = normalized.lower().replace(" ", "")
    if (
        simple_class_match in {"nursery", "lkg", "ukg"}
        or simple_class_match.rstrip("abcdefghijklmnopqrstuvwxyz") != simple_class_match
        or any(token in simple_class_match for token in ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th"])
    ):
        return normalized, None

    return None, None


def is_class_only_upload_name(batch_name: str | None) -> bool:
    class_name, _section = split_batch_to_class_section(batch_name)
    return bool(class_name) and not looks_like_academic_batch_name(batch_name)
