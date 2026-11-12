"""Paintings made for the places and people this branch can name."""

BY_NAME = {
    "守城人": "/art/guard.png",
    "商人": "/art/merchant.png",
    "学徒": "/art/apprentice.png",
    "卖水人": "/art/water.png",
    "巡夜人": "/art/watch.png",
    "饲兽人": "/art/tender.png",
}


def attach(snapshot: dict) -> dict:
    actors = [*(snapshot.get("actors") or []), *(snapshot.get("archivedActors") or [])]
    actors.extend(event["actor"] for event in snapshot.get("events") or [] if event.get("actor"))
    for actor in actors:
        actor["image"] = BY_NAME.get(actor.get("name") or "")
    origin = snapshot.get("origin") or ""
    name = snapshot.get("name") or ""
    snapshot["plate"] = "/art/atlas.jpg" if ("巨兽" in origin or "巨兽" in name) else ""
    return snapshot
