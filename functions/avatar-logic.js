"use strict";

const AVATAR_ITEM_SLOTS = Object.freeze({
  avatar_hair_wave: "hair",
  avatar_hair_curls: "hair",
  avatar_hair_silver: "hairColor",
  avatar_skin_sun: "skin",
  avatar_skin_cocoa: "skin",
  avatar_top_hoodie: "outfit",
  avatar_top_jacket: "outfit",
  avatar_glasses_round: "accessory",
  avatar_crown_neon: "accessory",
  avatar_hair_afro: "hair",
  avatar_hair_blue: "hairColor",
  avatar_skin_olive: "skin",
  avatar_top_sport: "outfit",
  avatar_top_space: "outfit",
  avatar_glasses_square: "accessory",
  avatar_earrings_star: "earrings",
  avatar_cap_mint: "headwear",
});

function equipAvatarItem(equippedItems, inventory, itemId) {
  const slot = AVATAR_ITEM_SLOTS[itemId];
  if (!slot) throw new Error("unknown-avatar-item");
  if (!Array.isArray(inventory) || !inventory.includes(itemId)) throw new Error("avatar-item-not-owned");
  const current = Array.isArray(equippedItems) ? equippedItems : [];
  return [...current.filter((equippedId) => AVATAR_ITEM_SLOTS[equippedId] !== slot), itemId];
}

function unequipAvatarSlot(equippedItems, slot) {
  if (!Object.values(AVATAR_ITEM_SLOTS).includes(slot)) throw new Error("unknown-avatar-slot");
  return (Array.isArray(equippedItems) ? equippedItems : [])
    .filter((itemId) => AVATAR_ITEM_SLOTS[itemId] !== slot);
}

module.exports = { AVATAR_ITEM_SLOTS, equipAvatarItem, unequipAvatarSlot };
