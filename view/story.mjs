// Pages of the storybook. Built only from events already stored on the world.

export function endCursor(pageCount) {
  return Math.max(0, pageCount - 2);
}

export function buildPages(world) {
  const actors = world?.actors || [];
  const archivedActors = world?.archivedActors || [];
  const locations = world?.locations || [];
  const events = world?.events || [];
  const nameToId = new Map(locations.map((location) => [location.name, location.id]));
  const actorCatalog = new Map();
  for (const actor of [...actors, ...archivedActors]) actorCatalog.set(actor.id, actor);
  for (const event of events) {
    if (event.actor?.id && !actorCatalog.has(event.actor.id)) actorCatalog.set(event.actor.id, event.actor);
  }

  const joined = new Set(events.filter((event) => event.action === "join" && event.ok).map((event) => event.agent));
  const left = new Set(events.filter((event) => event.action === "leave" && event.ok).map((event) => event.agent));
  const archivedIds = new Set(archivedActors.map((actor) => actor.id));
  const cursor = new Map();
  for (const actor of actors) {
    if (actor.id) cursor.set(actor.id, { ...actor });
  }
  // Old snapshots may not include archivedActors. Event actor snapshots still let
  // the story recover actors that have no explicit join or leave boundary.
  for (const event of events) {
    const actor = event.actor;
    if (!actor?.id || cursor.has(actor.id) || archivedIds.has(actor.id) || joined.has(actor.id) || left.has(actor.id)) continue;
    cursor.set(actor.id, { ...actor });
  }

  const after = new Array(events.length);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const actorId = event.agent;
    const move = event.action === "move" && event.ok ? parseMove(event.text, nameToId) : null;

    if (actorId && event.ok && event.action === "leave") {
      cursor.delete(actorId);
    } else if (actorId && event.ok && event.action === "join") {
      setActor(cursor, actorId, event.actor || actorCatalog.get(actorId), event.location || event.to_location || event.actor?.place);
    } else if (actorId && event.ok && event.action === "move") {
      const destination = event.to_location || event.location || move?.to || event.actor?.place;
      setActor(cursor, actorId, event.actor || actorCatalog.get(actorId), destination);
    } else if (actorId && event.location) {
      setActor(cursor, actorId, event.actor || actorCatalog.get(actorId), event.location);
    } else if (actorId && event.actor && cursor.has(actorId)) {
      setActor(cursor, actorId, event.actor, cursor.get(actorId).place || event.actor.place);
    }

    after[index] = cloneActors(cursor);

    if (!event.ok || !actorId) continue;
    if (event.action === "join") {
      cursor.delete(actorId);
    } else if (event.action === "leave") {
      const place = event.location || event.from_location || event.actor?.place || actorCatalog.get(actorId)?.place;
      setActor(cursor, actorId, event.actor || actorCatalog.get(actorId), place);
    } else if (event.action === "move") {
      const origin = event.from_location || move?.from;
      if (origin) setActor(cursor, actorId, event.actor || actorCatalog.get(actorId), origin);
    }
  }

  const pages = [{ kind: "title" }];
  let pending = null;
  const flush = () => {
    if (!pending) return;
    pages.push(scenePage(pending.tick, pending.placeId, pending.indexes, pending.state, events, actorCatalog));
    pending = null;
  };

  events.forEach((event, index) => {
    if (pending && pending.tick !== event.tick) flush();
    if (!event.action || event.action === "wait") return;
    const placeId = eventPlace(event, after[index], nameToId);
    if (!placeId) return;

    if (event.action === "join" || event.action === "leave") {
      flush();
      pages.push(scenePage(event.tick, placeId, [index], after[index], events, actorCatalog));
      return;
    }
    if (pending && pending.placeId === placeId) {
      pending.indexes.push(index);
      pending.state = after[index];
      return;
    }
    flush();
    pending = { tick: event.tick, placeId, indexes: [index], state: after[index] };
  });
  flush();

  const latestTick = events.at(-1)?.tick ?? 0;
  if (!pages.some((page) => page.tick === latestTick)) {
    const endState = after.at(-1) || cursor;
    const placeId = majorityPlace(endState, locations);
    if (placeId) pages.push(scenePage(latestTick, placeId, [], endState, events, actorCatalog));
  }
  return collapseRepeats(pages, events);
}

function scenePage(tick, placeId, indexes, state, events, actorCatalog) {
  const present = new Map();
  for (const [id, actor] of state || []) {
    if (actor.place === placeId) present.set(id, { ...actor });
  }
  for (const index of indexes) {
    const event = events[index];
    if (event.action !== "leave" || !event.ok || eventPlace(event, state || new Map(), new Map()) !== placeId) continue;
    const actor = event.actor || actorCatalog.get(event.agent);
    if (actor && !present.has(event.agent)) present.set(event.agent, { ...actor, place: placeId });
  }
  return {
    kind: "scene",
    tick,
    tickFrom: tick,
    tickTo: tick,
    placeId,
    present: [...present.keys()],
    actorSnapshots: [...present.values()],
    lines: indexes.map((eventIndex) => ({ actorId: events[eventIndex].agent, eventIndex })),
  };
}

function setActor(state, id, snapshot, place) {
  const current = state.get(id);
  const actor = snapshot || current || { id };
  state.set(id, { ...current, ...actor, id, place: place || current?.place || actor.place || "" });
}

function cloneActors(actors) {
  return new Map([...actors].map(([id, actor]) => [id, { ...actor }]));
}

function eventPlace(event, after, nameToId) {
  if (event.action === "leave") {
    return event.location || event.from_location || event.actor?.place || after.get(event.agent)?.place || "";
  }
  if (event.action === "move") {
    const parsed = parseMove(event.text, nameToId);
    return event.to_location || event.location || parsed?.to || event.actor?.place || after.get(event.agent)?.place || "";
  }
  return event.location || event.actor?.place || after.get(event.agent)?.place || "";
}

function parseMove(text, nameToId) {
  const matched = /从(.+?)到了([^。]+)/.exec(text || "");
  if (!matched) return null;
  return { from: nameToId.get(matched[1]), to: nameToId.get(matched[2]) };
}

function lineSignature(page, events) {
  return page.lines.map((line) => {
    const event = events[line.eventIndex];
    return `${line.actorId}|${event?.action}|${event?.ok}|${event?.text || ""}`;
  }).join("\n");
}

function collapseRepeats(pages, events) {
  const kept = [];
  for (const page of pages) {
    const prev = kept.at(-1);
    const same = prev
      && prev.kind === "scene"
      && page.kind === "scene"
      && prev.placeId === page.placeId
      && prev.present.join(",") === page.present.join(",")
      && lineSignature(prev, events) === lineSignature(page, events);
    if (same) {
      prev.tickTo = page.tick;
      continue;
    }
    kept.push(page);
  }
  return kept;
}

function majorityPlace(actors, locations) {
  const counts = new Map();
  for (const actor of actors.values()) {
    if (actor.place) counts.set(actor.place, (counts.get(actor.place) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const location of locations) {
    const count = counts.get(location.id) || 0;
    if (count > bestCount) {
      best = location.id;
      bestCount = count;
    }
  }
  return best;
}
