import type { PhysicalCategory } from "./librarySections";
import type { CategoryOrganization, CategorySection } from "./types";

const byOrderThenName = <T extends { sortOrder: number; name?: string; id?: string }>(left: T, right: T) =>
  left.sortOrder - right.sortOrder || (left.name || left.id || "").localeCompare(right.name || right.id || "", undefined, { sensitivity: "base", numeric: true });

export function reconcileCategoryOrganization(
  physicalCategories: PhysicalCategory[],
  saved: CategoryOrganization,
): CategoryOrganization {
  const validKeys = new Set(physicalCategories.map((category) => category.key));
  const groups = saved.groups
    .filter((group) => Boolean(group.section))
    .map((group) => ({ ...group }));
  const validGroupSections = new Map(groups.map((group) => [group.id, group.section]));
  const savedByKey = new Map(saved.categories.map((entry) => [entry.categoryKey, entry]));
  const nextOrder = new Map<CategorySection, number>();
  const sections = new Set<CategorySection>([...physicalCategories.map((category) => category.section), ...saved.categories.map((entry) => entry.section)]);
  for (const section of sections) {
    const maximum = saved.categories
      .filter((entry) => entry.section === section && !entry.groupId)
      .reduce((value, entry) => Math.max(value, entry.sortOrder), 0);
    nextOrder.set(section, maximum + 10);
  }
  const categories = physicalCategories.map((category) => {
    const savedEntry = savedByKey.get(category.key);
    const groupId = savedEntry && validGroupSections.get(savedEntry.groupId) === category.section ? savedEntry.groupId : "";
    if (savedEntry && savedEntry.section === category.section) {
      return { ...savedEntry, groupId };
    }
    const sortOrder = nextOrder.get(category.section) || 10;
    nextOrder.set(category.section, sortOrder + 10);
    return { categoryKey: category.key, section: category.section, groupId: "", sortOrder };
  });
  return {
    groups: groups.sort(byOrderThenName),
    categories: categories.filter((entry) => validKeys.has(entry.categoryKey)),
  };
}

export function orderedCategoryKeys(
  organization: CategoryOrganization,
  section: CategorySection,
  groupId: string,
): string[] {
  return organization.categories
    .filter((entry) => entry.section === section && entry.groupId === groupId)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.categoryKey.localeCompare(right.categoryKey))
    .map((entry) => entry.categoryKey);
}

export function moveCategory(
  organization: CategoryOrganization,
  categoryKey: string,
  section: CategorySection,
  groupId: string,
  beforeCategoryKey = "",
): CategoryOrganization {
  const categories = organization.categories.map((entry) => ({ ...entry }));
  const moving = categories.find((entry) => entry.categoryKey === categoryKey && entry.section === section);
  if (!moving || (groupId && !organization.groups.some((group) => group.id === groupId && group.section === section))) return organization;
  moving.groupId = groupId;
  const ordered = categories
    .filter((entry) => entry.section === section && entry.groupId === groupId && entry.categoryKey !== categoryKey)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.categoryKey.localeCompare(right.categoryKey));
  const beforeIndex = beforeCategoryKey ? ordered.findIndex((entry) => entry.categoryKey === beforeCategoryKey) : -1;
  ordered.splice(beforeIndex >= 0 ? beforeIndex : ordered.length, 0, moving);
  ordered.forEach((entry, index) => { entry.sortOrder = (index + 1) * 10; });
  return { groups: organization.groups.map((group) => ({ ...group })), categories };
}

export function moveGroup(
  organization: CategoryOrganization,
  section: CategorySection,
  groupId: string,
  beforeGroupId: string,
): CategoryOrganization {
  const moving = organization.groups.find((group) => group.id === groupId && group.section === section);
  if (!moving || groupId === beforeGroupId) return organization;
  const sectionGroups = organization.groups
    .filter((group) => group.section === section && group.id !== groupId)
    .sort(byOrderThenName);
  const beforeIndex = sectionGroups.findIndex((group) => group.id === beforeGroupId);
  sectionGroups.splice(beforeIndex >= 0 ? beforeIndex : sectionGroups.length, 0, { ...moving });
  sectionGroups.forEach((group, index) => { group.sortOrder = (index + 1) * 10; });
  const changed = new Map(sectionGroups.map((group) => [group.id, group]));
  return {
    groups: organization.groups.map((group) => changed.get(group.id) ?? { ...group }),
    categories: organization.categories.map((entry) => ({ ...entry })),
  };
}

export function removeGroup(organization: CategoryOrganization, groupId: string): CategoryOrganization {
  const group = organization.groups.find((item) => item.id === groupId);
  if (!group) return organization;
  const categories = organization.categories.map((entry) => ({ ...entry }));
  const ungrouped = categories
    .filter((entry) => entry.section === group.section && !entry.groupId)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  let nextOrder = (ungrouped.at(-1)?.sortOrder || 0) + 10;
  for (const entry of categories.filter((item) => item.groupId === groupId).sort((left, right) => left.sortOrder - right.sortOrder)) {
    entry.groupId = "";
    entry.sortOrder = nextOrder;
    nextOrder += 10;
  }
  return {
    groups: organization.groups.filter((item) => item.id !== groupId).map((item) => ({ ...item })),
    categories,
  };
}
