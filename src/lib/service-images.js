// Photographs for the public pages, cut from the client's own service artwork (public/images/services/).
// A service with no photo of its own gets one by the words in its name, then its category's, then a general one.

const DIR = '/images/services';

const BY_SLUG = {
  'regular-house-cleaning': 'regular-house-cleaning',
  'house-cleaning': 'regular-house-cleaning',
  'deep-cleaning': 'deep-cleaning',
  'move-in-cleaning': 'counter-clean',
  'move-out-cleaning': 'move-cleaning',
  'carpet-cleaning': 'carpet-cleaning',
  'furniture-assembly': 'furniture-assembly',
  'general-home-repairs': 'general-home-repairs',
  'tv-and-wall-mounting': 'tv-and-wall-mounting',
  'wall-and-drywall-repair': 'move-out-repair-package',
  'painting-touch-ups': 'painting-touch-ups',
  'shelving-and-storage-installation': 'shelving-and-storage',
  'move-out-repair-package': 'move-out-repair-package',
  'move-in-repair-package': 'move-in-repair-package',
};

const BY_WORD = [
  [/carpet/i, 'carpet-cleaning'],
  [/clean/i, 'counter-clean'],
  [/move|moving|pack|load/i, 'moving-help'],
  [/tv|mount/i, 'tv-and-wall-mounting'],
  [/assembl|furniture/i, 'furniture-assembly'],
  [/repair|handyman|drywall|paint|shelv/i, 'general-home-repairs'],
];

export const CATEGORY_IMAGES = {
  cleaning: `${DIR}/cleaning-banner.jpg`,
  movers: `${DIR}/moving-help.jpg`,
  moving: `${DIR}/moving-help.jpg`,
  handyman: `${DIR}/general-home-repairs.jpg`,
};

// A category's photo by the first word of its slug (moving-services -> moving), else its own image.
export function categoryImage(category) {
  if (!category) return null;
  const key = String(category.slug || category.name || '').toLowerCase().split(/[-\s]/)[0];
  return CATEGORY_IMAGES[key] || category.image_url || null;
}

export function serviceImage(service) {
  if (!service) return `${DIR}/counter-clean.jpg`;
  if (service.image_url) return service.image_url;
  const own = BY_SLUG[service.slug];
  if (own) return `${DIR}/${own}.jpg`;
  const text = `${service.name || ''} ${service.category_name || ''}`;
  const match = BY_WORD.find(([pattern]) => pattern.test(text));
  return `${DIR}/${match ? match[1] : 'counter-clean'}.jpg`;
}
