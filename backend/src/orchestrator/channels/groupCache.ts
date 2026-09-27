import type {GroupDocument} from "../../types";

/**
 * Decide which group owns a provider channel ID when two groups claim it.
 * The main group always wins so a stray group can't silently strip main-only
 * powers (e.g. create_feature) from the main channel.
 */
export const pickCachedGroup = ({
  existing,
  incoming,
}: {
  existing: GroupDocument | undefined;
  incoming: GroupDocument;
}): {group: GroupDocument; isConflict: boolean} => {
  if (!existing || existing._id.toString() === incoming._id.toString()) {
    return {group: incoming, isConflict: false};
  }

  if (existing.isMain && !incoming.isMain) {
    return {group: existing, isConflict: true};
  }

  return {group: incoming, isConflict: true};
};
