/** A small fixed scene used to exercise the map. Places and roads are data. */

export const story = {
  name: "山城驿站",
  tileSize: 16,
  locations: [
    { id: "gate", name: "城门", kind: "outdoor", w: 8, h: 7 },
    { id: "market", name: "市集", kind: "outdoor", w: 10, h: 8 },
    { id: "archive", name: "档案阁", kind: "indoor", w: 8, h: 7 },
    { id: "pier", name: "码头", kind: "waterfront", w: 9, h: 7 },
  ],
  links: [
    ["gate", "market"],
    ["market", "archive"],
    ["market", "pier"],
    ["gate", "pier"],
  ],
  actors: [
    { id: "ning", name: "阿宁", place: "gate", hue: 168 },
    { id: "huai", name: "老槐", place: "archive", hue: 24 },
    { id: "zhou", name: "小舟", place: "pier", hue: 206 },
  ],
  beats: [
    { actor: "ning", to: "market", text: "阿宁离开城门，到市集照看摊位。" },
    { actor: "huai", to: "market", text: "老槐把一卷名册带到市集。" },
    { actor: "zhou", to: "gate", text: "小舟从码头走到城门。" },
    { actor: "ning", to: "pier", text: "阿宁穿过市集，下到码头。" },
    { actor: "huai", to: "archive", text: "老槐回到档案阁。" },
  ],
};
