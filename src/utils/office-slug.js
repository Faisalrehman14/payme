function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function normalizeOfficeSlug(raw) {
  if (!raw) return "";
  try {
    return decodeURIComponent(String(raw)).trim().toLowerCase();
  } catch {
    return String(raw).trim().toLowerCase();
  }
}

module.exports = { slugify, normalizeOfficeSlug };
