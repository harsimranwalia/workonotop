// database/fixtures/catalog.js
// What a customer can book, and the settings the code reads for it. Plain data with no imports.
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
    // The parts of the pricing rules of services 1 and 2 (service 3 has none, so it books at its catalog price and duration). Every
    // figure is invented, labelled so, and marked is_placeholder = 1; the client's own figures replace them as rows with
    // is_placeholder = 0. The base of a rule is the service's own base_price and duration_minutes above, not a row here.
    // quote_from is the quantity from which a pick of the row sends a job to a quote, null when it never does; every row has the key,
    // as the loader refuses rows whose keys differ. Service 1 sends seven bedrooms and either property type after house to a quote.
    service_pricing_items: [
      { id: 1, service_id: 1, kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', amount: 20.0, minutes: 30, is_hourly: 0, quote_from: 7, is_placeholder: 1, sort_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 2, service_id: 1, kind: 'unit', code: 'bathrooms', label: 'Bathrooms (placeholder figure)', amount: 15.0, minutes: 20, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 2, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 3, service_id: 1, kind: 'option', code: 'standard', label: 'Standard clean (placeholder figure)', amount: 0.0, minutes: 0, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 4, service_id: 1, kind: 'option', code: 'deep', label: 'Deep clean (placeholder figure)', amount: 60.0, minutes: 60, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 2, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 5, service_id: 1, kind: 'option', code: 'hourly', label: 'By the hour (placeholder figure)', amount: 45.0, minutes: 0, is_hourly: 1, quote_from: null, is_placeholder: 1, sort_order: 3, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 6, service_id: 1, kind: 'property_type', code: 'apartment', label: 'Apartment (placeholder figure)', amount: 0.0, minutes: 0, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 7, service_id: 1, kind: 'property_type', code: 'house', label: 'House (placeholder figure)', amount: 25.0, minutes: 30, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 2, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 13, service_id: 1, kind: 'property_type', code: 'commercial', label: 'Commercial (placeholder figure)', amount: 0.0, minutes: 0, is_hourly: 0, quote_from: 1, is_placeholder: 1, sort_order: 3, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 14, service_id: 1, kind: 'property_type', code: 'post_construction', label: 'Post-construction (placeholder figure)', amount: 0.0, minutes: 0, is_hourly: 0, quote_from: 1, is_placeholder: 1, sort_order: 4, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 8, service_id: 1, kind: 'weekend', code: 'weekend', label: 'Weekend (placeholder figure)', amount: 30.0, minutes: 0, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 9, service_id: 1, kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', amount: 35.0, minutes: 30, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 10, service_id: 1, kind: 'extra', code: 'fridge', label: 'Fridge (placeholder figure)', amount: 30.0, minutes: 20, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 2, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 11, service_id: 2, kind: 'unit', code: 'bedrooms', label: 'Bedrooms (placeholder figure)', amount: 30.0, minutes: 45, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT },
      { id: 12, service_id: 2, kind: 'extra', code: 'oven', label: 'Oven (placeholder figure)', amount: 35.0, minutes: 30, is_hourly: 0, quote_from: null, is_placeholder: 1, sort_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT },
    ],
    // The commission the code falls back to (provider/available-jobs/route.js), so a fixture database
    // behaves as the code expects when the setting is absent. In the dev database this table's key is its
    // primary key and it has neither an id nor timestamps, so these rows carry none.
    system_settings: [
      { key: 'default_commission', value: '20' },
      // The percent taken off each visit of a repeating booking, by how often it repeats (src/lib/pricing-rules.js). Invented
      // placeholders, not the client's figures: a monthly series carries a discount line in the dev app, the other two do not.
      { key: 'recurring_discount_weekly_percent', value: '0' },
      { key: 'recurring_discount_every_2_weeks_percent', value: '0' },
      { key: 'recurring_discount_monthly_percent', value: '10' },
    ],
  },
};
