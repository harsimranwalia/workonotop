// database/fixtures/catalog.js
// What a customer can book, and the one setting the code reads for it. Plain data with no imports.
// The catalog is plausible and plainly invented; it is never shaped to make a test pass. Prices are
// placeholders. image_url stays NULL (identity rules: accounts.js).

const FIXED_AT = '2026-01-01 00:00:00';

export const catalog = {
  name: 'catalog',
  tables: {
    service_categories: [
      {
        id: 1,
        name: 'Fixture Cleaning',
        slug: 'fixture-cleaning',
        icon: 'brush-outline',
        description: 'Invented cleaning services for the dev environment.',
        is_active: 1,
        display_order: 1,
        created_at: FIXED_AT,
        updated_at: FIXED_AT,
      },
      {
        id: 2,
        name: 'Fixture Home Repairs',
        slug: 'fixture-home-repairs',
        icon: 'build-outline',
        description: 'Invented repair services for the dev environment.',
        is_active: 1,
        display_order: 2,
        created_at: FIXED_AT,
        updated_at: FIXED_AT,
      },
    ],
    services: [
      {
        id: 1,
        category_id: 1,
        name: 'Fixture Standard Clean',
        slug: 'fixture-standard-clean',
        description: 'Invented service: a standard clean of the main living areas.',
        short_description: 'A standard clean, for tests.',
        base_price: 80.0,
        additional_price: 40.0,
        duration_minutes: 120,
        use_cases: 'Standard clean',
        is_homepage: 1,
        is_trending: 0,
        is_popular: 1,
        is_active: 1,
        created_at: FIXED_AT,
        updated_at: FIXED_AT,
      },
      {
        id: 2,
        category_id: 1,
        name: 'Fixture Deep Clean',
        slug: 'fixture-deep-clean',
        description: 'Invented service: a deep clean including kitchen and bathrooms.',
        short_description: 'A deep clean, for tests.',
        base_price: 140.0,
        additional_price: 60.0,
        duration_minutes: 180,
        use_cases: 'Deep clean',
        is_homepage: 1,
        is_trending: 1,
        is_popular: 0,
        is_active: 1,
        created_at: FIXED_AT,
        updated_at: FIXED_AT,
      },
      {
        id: 3,
        category_id: 2,
        name: 'Fixture Furniture Assembly',
        slug: 'fixture-furniture-assembly',
        description: 'Invented service: assembly of flat-pack furniture.',
        short_description: 'Furniture assembly, for tests.',
        base_price: 100.0,
        additional_price: 50.0,
        duration_minutes: 90,
        use_cases: 'Furniture assembly',
        is_homepage: 0,
        is_trending: 0,
        is_popular: 0,
        is_active: 1,
        created_at: FIXED_AT,
        updated_at: FIXED_AT,
      },
    ],
    // The commission the code falls back to (provider/available-jobs/route.js), so a fixture database
    // behaves as the code expects when the setting is absent.
    system_settings: [{ key: 'default_commission', value: '20' }],
  },
};
