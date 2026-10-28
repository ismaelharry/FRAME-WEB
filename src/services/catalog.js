// Lectura del catálogo: espacios, productos y recursos.
import { json } from '../lib/util.js';

const L = (row, field, lang) => row[`${field}_${lang}`] ?? row[`${field}_es`] ?? '';

export function createCatalog(db) {
  const decodeProduct = (p) => p && ({
    ...p,
    includes: { es: json(p.includes_es, []), en: json(p.includes_en, []) },
  });
  const decodeResource = (r) => r && ({
    ...r,
    hours: json(r.hours, {}),
    equipment: { es: json(r.equipment_es, []), en: json(r.equipment_en, []) },
  });
  const decodeSpace = (s) => s && ({
    ...s,
    includes: { es: json(s.includes_es, []), en: json(s.includes_en, []) },
    equipment: { es: json(s.equipment_es, []), en: json(s.equipment_en, []) },
  });

  return {
    L,
    products: ({ all = false } = {}) => db.all(`SELECT * FROM products ${all ? '' : 'WHERE active = 1'} ORDER BY sort, id`).map(decodeProduct),
    product: (slug) => decodeProduct(db.get('SELECT * FROM products WHERE slug = ?', [slug])),
    productById: (id) => decodeProduct(db.get('SELECT * FROM products WHERE id = ?', [id])),
    resources: ({ all = false } = {}) => db.all(`SELECT * FROM resources ${all ? '' : 'WHERE active = 1'} ORDER BY sort, id`).map(decodeResource),
    resource: (slug) => decodeResource(db.get('SELECT * FROM resources WHERE slug = ?', [slug])),
    resourceById: (id) => decodeResource(db.get('SELECT * FROM resources WHERE id = ?', [id])),
    resourcesByGroup: (group) => db.all('SELECT * FROM resources WHERE group_slug = ? AND active = 1 ORDER BY sort, id', [group]).map(decodeResource),
    resourcesForProduct: (slug) => db.all('SELECT * FROM resources WHERE product_slug = ? AND active = 1 ORDER BY sort, id', [slug]).map(decodeResource),
    deskPool: () => decodeResource(db.get("SELECT * FROM resources WHERE kind = 'desk_pool' ORDER BY id LIMIT 1")),
    tourResource: () => decodeResource(db.get("SELECT * FROM resources WHERE kind = 'tour' AND active = 1 ORDER BY id LIMIT 1")),
    spaces: ({ all = false } = {}) => db.all(`SELECT * FROM spaces ${all ? '' : 'WHERE visible = 1'} ORDER BY sort, id`).map(decodeSpace),
    space: (slug) => decodeSpace(db.get('SELECT * FROM spaces WHERE slug = ?', [slug])),
    media: (slot) => db.all('SELECT * FROM media WHERE slot = ? ORDER BY sort, id', [slot]),
    allMedia: () => db.all('SELECT * FROM media ORDER BY slot, sort, id'),
    faqs: ({ all = false } = {}) => db.all(`SELECT * FROM faqs ${all ? '' : 'WHERE visible = 1'} ORDER BY sort, id`),
  };
}
