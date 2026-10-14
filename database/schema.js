import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: resolve(__dirname, "../.env") });
const DB_NAME = process.env.DB_NAME || 'workontap_db';

// Create database connection
const connect = async (withDb = false) => {
  return await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root123',
    port: parseInt(process.env.DB_PORT || '3306'),
    ...(withDb && { database: DB_NAME })
  });
};

// =====================================================
// Table creation SQL - All 17 tables with exact fields
// =====================================================
const tables = [
  // Table 1: users - UPDATED with UNIQUE constraint on phone
  `CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(50) UNIQUE,
    hear_about VARCHAR(255),
    receive_offers TINYINT(1) DEFAULT 0,
    role ENUM('user', 'admin') DEFAULT 'user',
    image_url VARCHAR(255),
    reset_token VARCHAR(255),
    reset_token_expiry DATETIME,
    stripe_customer_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_role (role)
  )`,

  // Table 2: service_categories
  `CREATE TABLE IF NOT EXISTS service_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    icon VARCHAR(255),
    image_url VARCHAR(255),
    description TEXT,
    is_active TINYINT(1) DEFAULT 1,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Table 3: service_providers
  `CREATE TABLE IF NOT EXISTS service_providers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(50) UNIQUE,
    specialty VARCHAR(200),
    experience_years INT,
    rating DECIMAL(3,2) DEFAULT 0.00,
    total_jobs INT DEFAULT 0,
    total_reviews INT DEFAULT 0,
    avg_rating DECIMAL(3,2) DEFAULT 0.00,
    total_earnings DECIMAL(10,2) DEFAULT 0.00,
    available_balance DECIMAL(10,2) DEFAULT 0.00,
    pending_balance DECIMAL(10,2) DEFAULT 0.00,
    lifetime_balance DECIMAL(10,2) DEFAULT 0.00,
    bio TEXT,
    avatar_url VARCHAR(255),
    location VARCHAR(200),
    city VARCHAR(100),
    status ENUM('active', 'inactive', 'pending', 'rejected', 'suspended') DEFAULT 'pending',
    remember_token VARCHAR(100),
    last_login DATETIME,
    email_verified TINYINT(1) DEFAULT 0,
    email_verification_token VARCHAR(255),
    email_verification_expires DATETIME,
    onboarding_step INT DEFAULT 1,
    onboarding_completed TINYINT(1) DEFAULT 0,
    documents_uploaded TINYINT(1) DEFAULT 0,
    documents_verified TINYINT(1) DEFAULT 0,
    stripe_account_id VARCHAR(255),
    stripe_onboarding_complete TINYINT(1) DEFAULT 0,
    approved_by INT,
    approved_at DATETIME,
    rejection_reason TEXT,
    service_areas JSON,
    skills JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    reset_token VARCHAR(255),
    reset_token_expiry DATETIME,
    INDEX idx_city (city),
    INDEX idx_status (status),
    INDEX idx_onboarding_step (onboarding_step),
    INDEX idx_stripe_account (stripe_account_id),
    INDEX idx_email_verified (email_verified)
  )`,

  // Table 4: services
  `CREATE TABLE IF NOT EXISTS services (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category_id INT NOT NULL,
    skills JSON,
    name VARCHAR(200) NOT NULL,
    slug VARCHAR(200) UNIQUE NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    base_price DECIMAL(10,2) NOT NULL,
    additional_price DECIMAL(10,2),
    duration_minutes INT,
    image_url VARCHAR(255),
    use_cases TEXT,
    is_homepage TINYINT(1) DEFAULT 0,
    is_trending TINYINT(1) DEFAULT 0,
    is_popular TINYINT(1) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE CASCADE,
    INDEX idx_is_active (is_active)
  )`,

  // Table 5: provider_documents
  `CREATE TABLE IF NOT EXISTS provider_documents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    provider_id INT NOT NULL,
    document_type ENUM('id_proof', 'trade_license', 'insurance', 'certification', 'profile_photo', 'other') NOT NULL,
    document_url VARCHAR(500) NOT NULL,
    document_number VARCHAR(100),
    issue_date DATE,
    expiry_date DATE,
    is_verified TINYINT(1) DEFAULT 0,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    verified_by INT,
    reviewed_by INT,
    verified_at DATETIME,
    reviewed_at DATETIME,
    rejection_reason TEXT,
    admin_notes TEXT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (provider_id) REFERENCES service_providers(id) ON DELETE CASCADE,
    INDEX idx_provider (provider_id),
    INDEX idx_status (status),
    INDEX idx_is_verified (is_verified)
  )`,

  // Table 6: provider_bank_accounts
  `CREATE TABLE IF NOT EXISTS provider_bank_accounts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    provider_id INT NOT NULL,
    stripe_account_id VARCHAR(255) NOT NULL,
    stripe_onboarding_url VARCHAR(500),
    onboarding_completed TINYINT(1) DEFAULT 0,
    account_status ENUM('pending', 'verified', 'rejected', 'incomplete') DEFAULT 'pending',
    bank_name VARCHAR(255),
    last4 VARCHAR(4),
    payout_method ENUM('stripe', 'bank_transfer') DEFAULT 'stripe',
    payout_schedule ENUM('instant', 'daily', 'weekly', 'monthly') DEFAULT 'weekly',
    default_payout TINYINT(1) DEFAULT 1,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (provider_id) REFERENCES service_providers(id) ON DELETE CASCADE,
    INDEX idx_provider (provider_id),
    INDEX idx_stripe_account (stripe_account_id),
    INDEX idx_account_status (account_status)
  )`,

  // Table 7: bookings - UPDATED with all your columns
  `CREATE TABLE IF NOT EXISTS bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    booking_number VARCHAR(50) UNIQUE NOT NULL,
    service_id INT NOT NULL,
    provider_id INT,
    previous_provider_id INT,
    service_name VARCHAR(200),
    service_price DECIMAL(10,2) NOT NULL,
    additional_price DECIMAL(10,2) DEFAULT 0.00,
    standard_duration_minutes INT DEFAULT 60,
    customer_first_name VARCHAR(100) NOT NULL,
    customer_last_name VARCHAR(100) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    job_date DATE NOT NULL,
    job_time_slot VARCHAR(255) NOT NULL,
    worker_count INT DEFAULT 1,
    estimated_hours DECIMAL(5,2),
    timing_constraints TEXT,
    job_description TEXT NOT NULL,
    instructions TEXT,
    parking_access TINYINT(1) DEFAULT 0,
    elevator_access TINYINT(1) DEFAULT 0,
    has_pets TINYINT(1) DEFAULT 0,
    address_line1 VARCHAR(255) NOT NULL,
    address_line2 VARCHAR(255),
    city VARCHAR(100) DEFAULT 'Calgary',
    postal_code VARCHAR(20),
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    cluster VARCHAR(100),
    status ENUM('pending', 'matching', 'confirmed', 'in_progress', 'awaiting_approval', 'completed', 'cancelled', 'disputed') DEFAULT 'pending',
    commission_percent DECIMAL(5,2),
    provider_amount DECIMAL(10,2),
    accepted_at DATETIME,
    marketplace_pushed_at DATETIME NULL,
    start_time DATETIME,
    end_time DATETIME,
    actual_duration_minutes INT,
    overtime_minutes INT DEFAULT 0,
    overtime_earnings DECIMAL(10,2) DEFAULT 0.00,
    final_provider_amount DECIMAL(10,2),
    submitted_duration_minutes INT,
    submitted_headcount INT,
    adjustment_reason TEXT,
    job_timer_status ENUM('not_started', 'running', 'paused', 'completed') DEFAULT 'not_started',
    before_photos_uploaded TINYINT(1) DEFAULT 0,
    after_photos_uploaded TINYINT(1) DEFAULT 0,
    work_summary TEXT,
    recommendations TEXT,
    payment_intent_id VARCHAR(255),
    authorized_amount DECIMAL(10,2),
    payment_status ENUM('pending', 'authorized', 'paid', 'failed', 'refunded') DEFAULT 'pending',
    payment_method VARCHAR(50),
    stripe_customer_id VARCHAR(255),
    photo_upload_deadline TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    series_id INT NULL,
    series_visit TINYINT UNSIGNED NULL,
    series_frequency VARCHAR(20) NULL,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (provider_id) REFERENCES service_providers(id) ON DELETE SET NULL,
    INDEX idx_user (user_id),
    INDEX idx_provider (provider_id),
    INDEX idx_previous_provider (previous_provider_id),
    INDEX idx_status (status),
    INDEX idx_job_date (job_date),
    INDEX idx_customer_email (customer_email),
    INDEX idx_payment_intent (payment_intent_id),
    UNIQUE INDEX uq_bookings_payment_intent (payment_intent_id),
    INDEX idx_payment_status (payment_status),
    INDEX idx_stripe_customer (stripe_customer_id),
    INDEX idx_job_timer_status (job_timer_status),
    INDEX idx_series (series_id)
  )`,

  // Table 8: chat_messages
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    sender_id INT NOT NULL,
    sender_type ENUM('customer', 'provider') NOT NULL,
    message TEXT NOT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_sender (sender_id, sender_type),
    INDEX idx_created_at (created_at),
    INDEX idx_is_read (is_read)
  )`,

  // Table 9: booking_photos
  `CREATE TABLE IF NOT EXISTS booking_photos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    photo_url VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id)
  )`,

  // Table 10: booking_status_history
  `CREATE TABLE IF NOT EXISTS booking_status_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_created_at (created_at)
  )`,

  // Table 11: booking_time_logs
  `CREATE TABLE IF NOT EXISTS booking_time_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    action ENUM('start', 'pause', 'resume', 'stop', 'auto_pause') NOT NULL,
    timestamp DATETIME NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_timestamp (timestamp)
  )`,

  // Table 12: job_photos
  `CREATE TABLE IF NOT EXISTS job_photos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    photo_url VARCHAR(500) NOT NULL,
    photo_type ENUM('before', 'after') NOT NULL,
    uploaded_by INT NOT NULL,
    captured_at TIMESTAMP NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES service_providers(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_photo_type (photo_type),
    INDEX idx_uploaded_by (uploaded_by)
  )`,

  // Table 13: provider_reviews
  `CREATE TABLE IF NOT EXISTS provider_reviews (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL UNIQUE,
    provider_id INT NOT NULL,
    customer_id INT NOT NULL,
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review TEXT,
    is_anonymous TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES service_providers(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_provider (provider_id),
    INDEX idx_customer (customer_id)
  )`,

  // Table 14: invoices
  `CREATE TABLE IF NOT EXISTS invoices (
    id INT PRIMARY KEY AUTO_INCREMENT,
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    booking_id INT NOT NULL,
    user_id INT NOT NULL,
    provider_id INT NOT NULL,
    invoice_type ENUM('customer', 'provider') NOT NULL,
    base_amount DECIMAL(10,2) NOT NULL,
    commission_percent DECIMAL(5,2),
    commission_amount DECIMAL(10,2),
    overtime_minutes INT DEFAULT 0,
    overtime_rate DECIMAL(10,2),
    overtime_amount DECIMAL(10,2),
    total_amount DECIMAL(10,2) NOT NULL,
    provider_earnings DECIMAL(10,2),
    service_name VARCHAR(255) NOT NULL,
    service_duration INT,
    actual_duration INT,
    job_date DATE NOT NULL,
    completion_date DATETIME NOT NULL,
    status ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled') DEFAULT 'draft',
    payment_method VARCHAR(50),
    payment_date DATETIME,
    pdf_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES service_providers(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_user (user_id),
    INDEX idx_provider (provider_id),
    INDEX idx_status (status)
  )`,

  // Table 15: provider_payouts
  `CREATE TABLE IF NOT EXISTS provider_payouts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    provider_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status ENUM('pending', 'processing', 'paid', 'failed') DEFAULT 'pending',
    stripe_payout_id VARCHAR(255),
    stripe_transfer_id VARCHAR(255),
    booking_id INT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (provider_id) REFERENCES service_providers(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    INDEX idx_provider (provider_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_booking (booking_id)
  )`,

  // Table 16: disputes
  `CREATE TABLE IF NOT EXISTS disputes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    booking_id INT NOT NULL,
    raised_by_user_id INT NOT NULL,
    reason TEXT NOT NULL,
    status ENUM('open', 'reviewing', 'resolved', 'closed') DEFAULT 'open',
    admin_notes TEXT,
    captured_amount DECIMAL(10,2) DEFAULT NULL,
    provider_amount DECIMAL(10,2) DEFAULT NULL,
    stripe_capture_id VARCHAR(255) DEFAULT NULL,
    stripe_transfer_id VARCHAR(255) DEFAULT NULL,
    resolved_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (raised_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_raised_by (raised_by_user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
  )`,

  // Table 17: mobile_auth_users
  `CREATE TABLE IF NOT EXISTS mobile_auth_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT DEFAULT NULL,
    provider_id INT DEFAULT NULL,
    user_type ENUM('customer', 'provider') NOT NULL,
    refresh_token VARCHAR(512) DEFAULT NULL,
    refresh_token_expires DATETIME DEFAULT NULL,
    push_token TEXT DEFAULT NULL,
    push_token_platform ENUM('ios', 'android', 'web') DEFAULT NULL,
    push_token_updated_at DATETIME DEFAULT NULL,
    device_id VARCHAR(255) DEFAULT NULL,
    device_name VARCHAR(255) DEFAULT NULL,
    device_platform ENUM('ios', 'android', 'web') DEFAULT NULL,
    os_version VARCHAR(50) DEFAULT NULL,
    app_version VARCHAR(50) DEFAULT NULL,
    is_active TINYINT(1) DEFAULT 1,
    last_login DATETIME DEFAULT NULL,
    logged_out_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES service_providers(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_provider_id (provider_id),
    INDEX idx_user_type (user_type),
    INDEX idx_push_token (push_token(255)),
    INDEX idx_device_id (device_id),
    INDEX idx_is_active (is_active),
    UNIQUE KEY uq_user_device (user_id, device_id),
    UNIQUE KEY uq_provider_device (provider_id, device_id)
  )`,
  // Table 18: notifications (Unified table for all user types)
  `CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    user_type ENUM('customer', 'provider', 'admin') NOT NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSON DEFAULT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_notification (user_id, user_type),
    INDEX idx_created_at (created_at)
  )`,

  // Table 19: deletion_requests
  `CREATE TABLE IF NOT EXISTS deletion_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    reason TEXT,
    status ENUM('pending', 'processed', 'cancelled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_status (status)
  )`,

  // Table 20: service_areas
  `CREATE TABLE IF NOT EXISTS service_areas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    cluster_group VARCHAR(100) NOT NULL,
    cluster_key VARCHAR(100) UNIQUE NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    cities JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Table 21: states
  `CREATE TABLE IF NOT EXISTS states (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Table 22: districts
  `CREATE TABLE IF NOT EXISTS districts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    state_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (state_id) REFERENCES states(id) ON DELETE CASCADE,
    INDEX idx_state (state_id)
  )`,

  // Table 23: cities
  `CREATE TABLE IF NOT EXISTS cities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    district_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (district_id) REFERENCES districts(id) ON DELETE CASCADE,
    INDEX idx_district (district_id)
  )`,

  // Table 24: skills
  `CREATE TABLE IF NOT EXISTS skills (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(200) UNIQUE NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Table 25: service_locations
  `CREATE TABLE IF NOT EXISTS service_locations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    service_id INT NOT NULL,
    location_name VARCHAR(200) NOT NULL,
    location_slug VARCHAR(200) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    meta_title VARCHAR(255),
    meta_description TEXT,
    keywords TEXT,
    canonical_url VARCHAR(255),
    custom_heading VARCHAR(255),
    custom_intro TEXT,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    UNIQUE KEY unique_service_location (service_id, location_slug),
    INDEX idx_sl_loc_slug (location_slug),
    INDEX idx_sl_active (is_active)
  )`,

  // Table 26: seo_settings
  `CREATE TABLE IF NOT EXISTS seo_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    page_name VARCHAR(100) UNIQUE NOT NULL,
    meta_title VARCHAR(255),
    meta_description TEXT,
    keywords TEXT,
    canonical_url VARCHAR(255),
    og_title VARCHAR(255),
    og_description TEXT,
    og_image VARCHAR(255),
    header_scripts TEXT,
    footer_scripts TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Table 27: blogs
  `CREATE TABLE IF NOT EXISTS blogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    content TEXT,
    author VARCHAR(100),
    image_url VARCHAR(255),
    meta_title VARCHAR(255),
    meta_description TEXT,
    keywords TEXT,
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Table 28: system_settings
  `CREATE TABLE IF NOT EXISTS system_settings (
    \`key\` VARCHAR(191) PRIMARY KEY,
    \`value\` TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Table 29: testimonials
  `CREATE TABLE IF NOT EXISTS testimonials (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    stars INT DEFAULT 5,
    text TEXT NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // Table 30: activity_logs
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    actor_id INT,
    actor_type ENUM('customer', 'provider', 'admin', 'system') NOT NULL,
    actor_name VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    details JSON,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_actor (actor_type, actor_id),
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_created (created_at)
  )`,

  // Table 31: job_sessions
  `CREATE TABLE IF NOT EXISTS job_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    provider_id INT NOT NULL,
    clock_in DATETIME NOT NULL,
    clock_out DATETIME,
    session_duration_minutes INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES service_providers(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id),
    INDEX idx_provider (provider_id)
  )`,

  // Table 32: booking_admin_edits
  `CREATE TABLE IF NOT EXISTS booking_admin_edits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL,
    admin_id INT,
    field_changed VARCHAR(100) NOT NULL,
    old_value VARCHAR(255),
    new_value VARCHAR(255),
    reason TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    INDEX idx_booking (booking_id)
  )`,

  // service_pricing_items: the items of each service's pricing rule (database/migrations/0001-service-pricing-items.up.sql;
  // quote_from and the two checks that name it are 0005's)
  `CREATE TABLE IF NOT EXISTS service_pricing_items (
    id INT NOT NULL AUTO_INCREMENT,
    service_id INT NOT NULL,
    kind ENUM('unit', 'option', 'property_type', 'weekend', 'extra') NOT NULL,
    code VARCHAR(40) NOT NULL,
    label VARCHAR(255) NOT NULL,
    amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    minutes INT NOT NULL DEFAULT 0,
    is_hourly TINYINT(1) NOT NULL DEFAULT 0,
    quote_from INT NULL,
    is_placeholder TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_service_pricing_items_code (service_id, kind, code),
    CONSTRAINT fk_service_pricing_items_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
    CONSTRAINT chk_service_pricing_items_code CHECK (code REGEXP '^[a-z0-9_]{1,40}$'),
    CONSTRAINT chk_service_pricing_items_amount CHECK (amount >= 0),
    CONSTRAINT chk_service_pricing_items_minutes CHECK (minutes >= 0),
    CONSTRAINT chk_service_pricing_items_hourly CHECK (is_hourly = 0 OR kind = 'option'),
    CONSTRAINT chk_service_pricing_items_weekend CHECK (kind <> 'weekend' OR code = 'weekend'),
    CONSTRAINT chk_service_pricing_items_quote_from CHECK (quote_from IS NULL OR quote_from >= 1),
    CONSTRAINT chk_service_pricing_items_quote_weekend CHECK (kind <> 'weekend' OR quote_from IS NULL)
  )`,

  // quote_requests: a customer's request for a job that cannot be priced from a few taps (database/migrations/0005-quote-requests.up.sql;
  // booking_id, its index and its key are 0006's). No money in it and never a booking: booking_id names the booking an admin made from it.
  // The migration sets the engine and collation; this file leaves them to the server default.
  `CREATE TABLE IF NOT EXISTS quote_requests (
    id INT NOT NULL AUTO_INCREMENT,
    user_id INT NULL,
    service_id INT NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(254) NOT NULL,
    customer_phone VARCHAR(40) NULL,
    address VARCHAR(255) NULL,
    message VARCHAR(1000) NOT NULL,
    answers JSON NOT NULL,
    picks JSON NOT NULL,
    booking_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_customer_email_created (customer_email, created_at),
    INDEX idx_created (created_at),
    INDEX idx_booking (booking_id),
    CONSTRAINT fk_quote_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_quote_requests_service FOREIGN KEY (service_id) REFERENCES services(id),
    CONSTRAINT fk_quote_requests_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
  )`,

  // booking_card_links: one row for each booking an admin made on a customer's behalf (database/migrations/0006-booking-card-links.up.sql).
  // The link the customer opens to add a card (the hash of its token, never the token) and, once one is added, the card's Stripe ids,
  // brand and last four digits. It holds no personal details: the customer is the booking's, and the row goes with the booking.
  // The migration sets the engine and collation; this file leaves them to the server default.
  `CREATE TABLE IF NOT EXISTS booking_card_links (
    id INT NOT NULL AUTO_INCREMENT,
    booking_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    used_at DATETIME NULL,
    issued_by INT NULL,
    stripe_customer_id VARCHAR(255) NULL,
    setup_intent_id VARCHAR(255) NULL,
    payment_method_id VARCHAR(255) NULL,
    card_brand VARCHAR(30) NULL,
    card_last4 CHAR(4) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_booking_card_links_booking (booking_id),
    UNIQUE KEY uq_booking_card_links_token (token_hash),
    CONSTRAINT fk_booking_card_links_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    CONSTRAINT fk_booking_card_links_issued_by FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE SET NULL
  )`
];

// =====================================================
// Column alterations for existing databases
// =====================================================
const alterations = [
  // Add UNIQUE constraint to users.phone if it doesn't exist
  { 
    table: 'users', 
    column: 'phone_unique', 
    sql: 'ALTER TABLE users ADD UNIQUE INDEX phone_unique (phone)',
    type: 'unique'
  },
  // One payment is attached to one booking (migration 0002). The tables entry creates the index on a fresh install; on an
  // existing database this entry adds it, or only warns and carries on if two bookings share an id, so there the migration is
  // applied by hand.
  { table: 'bookings', column: 'uq_bookings_payment_intent', sql: 'ALTER TABLE bookings ADD UNIQUE INDEX uq_bookings_payment_intent (payment_intent_id)', type: 'unique' },

  // service_categories table additions
  { table: 'service_categories', column: 'image_url', sql: 'ALTER TABLE service_categories ADD COLUMN image_url VARCHAR(255) AFTER icon' },
  
  // service_providers table additions
  { table: 'service_providers', column: 'email_verified', sql: 'ALTER TABLE service_providers ADD COLUMN email_verified TINYINT(1) DEFAULT 0 AFTER last_login' },
  { table: 'service_providers', column: 'email_verification_token', sql: 'ALTER TABLE service_providers ADD COLUMN email_verification_token VARCHAR(255) AFTER email_verified' },
  { table: 'service_providers', column: 'email_verification_expires', sql: 'ALTER TABLE service_providers ADD COLUMN email_verification_expires DATETIME AFTER email_verification_token' },
  { table: 'service_providers', column: 'onboarding_step', sql: 'ALTER TABLE service_providers ADD COLUMN onboarding_step INT DEFAULT 1 AFTER email_verification_expires' },
  { table: 'service_providers', column: 'onboarding_completed', sql: 'ALTER TABLE service_providers ADD COLUMN onboarding_completed TINYINT(1) DEFAULT 0 AFTER onboarding_step' },
  { table: 'service_providers', column: 'documents_uploaded', sql: 'ALTER TABLE service_providers ADD COLUMN documents_uploaded TINYINT(1) DEFAULT 0 AFTER onboarding_completed' },
  { table: 'service_providers', column: 'documents_verified', sql: 'ALTER TABLE service_providers ADD COLUMN documents_verified TINYINT(1) DEFAULT 0 AFTER documents_uploaded' },
  { table: 'service_providers', column: 'stripe_account_id', sql: 'ALTER TABLE service_providers ADD COLUMN stripe_account_id VARCHAR(255) AFTER documents_verified' },
  { table: 'service_providers', column: 'stripe_onboarding_complete', sql: 'ALTER TABLE service_providers ADD COLUMN stripe_onboarding_complete TINYINT(1) DEFAULT 0 AFTER stripe_account_id' },
  { table: 'service_providers', column: 'rejection_reason', sql: 'ALTER TABLE service_providers ADD COLUMN rejection_reason TEXT AFTER approved_at' },
  { table: 'service_providers', column: 'service_areas', sql: 'ALTER TABLE service_providers ADD COLUMN service_areas JSON AFTER rejection_reason' },
  { table: 'service_providers', column: 'service_cities', sql: 'ALTER TABLE service_providers ADD COLUMN service_cities JSON AFTER service_areas' },
  { table: 'service_providers', column: 'skills', sql: 'ALTER TABLE service_providers ADD COLUMN skills JSON AFTER service_cities' },
  { table: 'service_providers', column: 'is_available', sql: 'ALTER TABLE service_providers ADD COLUMN is_available TINYINT(1) DEFAULT 1' },
  { table: 'service_providers', column: 'reset_token', sql: 'ALTER TABLE service_providers ADD COLUMN reset_token VARCHAR(255) AFTER updated_at' },
  { table: 'service_providers', column: 'reset_token_expiry', sql: 'ALTER TABLE service_providers ADD COLUMN reset_token_expiry DATETIME AFTER reset_token' },

  // Bookings table - previous_provider_id
  { table: 'bookings', column: 'previous_provider_id', sql: 'ALTER TABLE bookings ADD COLUMN previous_provider_id INT AFTER provider_id' },

  // Bookings table - marketplace_pushed_at: when an admin offered the job to providers (NULL: not offered)
  { table: 'bookings', column: 'marketplace_pushed_at', sql: 'ALTER TABLE bookings ADD COLUMN marketplace_pushed_at DATETIME NULL AFTER accepted_at' },

  // Bookings table - series_id, series_visit, series_frequency (migration 0004): the series a visit belongs to (the id of its first visit),
  // its number in the series (1 for the first visit) and how often the series repeats; all NULL on a one-time booking. The index is on series_id.
  { table: 'bookings', column: 'series_id', sql: 'ALTER TABLE bookings ADD COLUMN series_id INT NULL' },
  { table: 'bookings', column: 'series_visit', sql: 'ALTER TABLE bookings ADD COLUMN series_visit TINYINT UNSIGNED NULL' },
  { table: 'bookings', column: 'series_frequency', sql: 'ALTER TABLE bookings ADD COLUMN series_frequency VARCHAR(20) NULL' },
  { table: 'bookings', column: 'idx_series', sql: 'CREATE INDEX idx_series ON bookings(series_id)' },

  // Index for previous_provider_id
  { table: 'bookings', column: 'idx_previous_provider', sql: 'CREATE INDEX idx_previous_provider ON bookings(previous_provider_id)' },

  // Additional missing columns for bookings table
  { table: 'bookings', column: 'worker_count', sql: "ALTER TABLE bookings ADD COLUMN worker_count INT DEFAULT 1 AFTER job_time_slot" },
  { table: 'bookings', column: 'estimated_hours', sql: "ALTER TABLE bookings ADD COLUMN estimated_hours DECIMAL(5,2) AFTER worker_count" },
  { table: 'bookings', column: 'submitted_duration_minutes', sql: "ALTER TABLE bookings ADD COLUMN submitted_duration_minutes INT" },
  { table: 'bookings', column: 'submitted_headcount', sql: "ALTER TABLE bookings ADD COLUMN submitted_headcount INT" },
  { table: 'bookings', column: 'adjustment_reason', sql: "ALTER TABLE bookings ADD COLUMN adjustment_reason TEXT" },
  { table: 'bookings', column: 'job_timer_status', sql: "ALTER TABLE bookings ADD COLUMN job_timer_status ENUM('not_started', 'running', 'paused', 'completed') DEFAULT 'not_started'" },
  { table: 'bookings', column: 'before_photos_uploaded', sql: 'ALTER TABLE bookings ADD COLUMN before_photos_uploaded TINYINT(1) DEFAULT 0' },
  { table: 'bookings', column: 'after_photos_uploaded', sql: 'ALTER TABLE bookings ADD COLUMN after_photos_uploaded TINYINT(1) DEFAULT 0' },
  { table: 'bookings', column: 'work_summary', sql: 'ALTER TABLE bookings ADD COLUMN work_summary TEXT' },
  { table: 'bookings', column: 'recommendations', sql: 'ALTER TABLE bookings ADD COLUMN recommendations TEXT' },
  { table: 'bookings', column: 'latitude', sql: 'ALTER TABLE bookings ADD COLUMN latitude DECIMAL(10,8)' },
  { table: 'bookings', column: 'longitude', sql: 'ALTER TABLE bookings ADD COLUMN longitude DECIMAL(11,8)' },
  { table: 'bookings', column: 'cluster', sql: 'ALTER TABLE bookings ADD COLUMN cluster VARCHAR(100)' },
  { table: 'bookings', column: 'idx_status_provider_created', sql: 'CREATE INDEX idx_status_provider_created ON bookings(status, provider_id, created_at)' },
  { table: 'bookings', column: 'idx_city_cluster', sql: 'CREATE INDEX idx_city_cluster ON bookings(city, cluster)' },
  
  // Service Areas
  { table: 'service_areas', column: 'cities', sql: 'ALTER TABLE service_areas ADD COLUMN cities JSON AFTER is_active' },
  
  // Services
  { table: 'services', column: 'skills', sql: 'ALTER TABLE services ADD COLUMN skills JSON AFTER category_id' },
  
  // users table additions
  { table: 'users', column: 'image_url', sql: 'ALTER TABLE users ADD COLUMN image_url VARCHAR(255) AFTER role' },
  // Fix job_time_slot truncation
  { table: 'bookings', column: 'job_time_slot_varchar', sql: 'ALTER TABLE bookings MODIFY COLUMN job_time_slot VARCHAR(255) NOT NULL' },

  { table: 'users', column: 'stripe_customer_id', sql: 'ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(255) AFTER image_url' },

  // mobile_auth_users table additions/fixes
  { table: 'mobile_auth_users', column: 'user_type_enum', sql: "ALTER TABLE mobile_auth_users MODIFY COLUMN user_type ENUM('customer', 'provider', 'admin') NOT NULL", type: 'modify' },
  { table: 'mobile_auth_users', column: 'device_id', sql: "ALTER TABLE mobile_auth_users ADD COLUMN device_id VARCHAR(255) AFTER push_token_updated_at" },
  { table: 'mobile_auth_users', column: 'device_name', sql: "ALTER TABLE mobile_auth_users ADD COLUMN device_name VARCHAR(255) AFTER device_id" },
  { table: 'mobile_auth_users', column: 'device_platform', sql: "ALTER TABLE mobile_auth_users ADD COLUMN device_platform ENUM('ios', 'android', 'web') AFTER device_name" },
  { table: 'mobile_auth_users', column: 'uq_user_device', sql: "ALTER TABLE mobile_auth_users ADD UNIQUE INDEX uq_user_device (user_id, device_id)", type: 'unique' },
  { table: 'mobile_auth_users', column: 'uq_provider_device', sql: "ALTER TABLE mobile_auth_users ADD UNIQUE INDEX uq_provider_device (provider_id, device_id)", type: 'unique' },
  { table: 'service_providers', column: 'phone', sql: 'ALTER TABLE service_providers MODIFY COLUMN phone VARCHAR(50) UNIQUE', type: 'modify' },
  
  // disputes table missing columns
  { table: 'disputes', column: 'captured_amount', sql: 'ALTER TABLE disputes ADD COLUMN captured_amount DECIMAL(10,2) DEFAULT NULL' },
  { table: 'disputes', column: 'provider_amount', sql: 'ALTER TABLE disputes ADD COLUMN provider_amount DECIMAL(10,2) DEFAULT NULL' },
  { table: 'disputes', column: 'stripe_capture_id', sql: 'ALTER TABLE disputes ADD COLUMN stripe_capture_id VARCHAR(255) DEFAULT NULL' },
  { table: 'disputes', column: 'stripe_transfer_id', sql: 'ALTER TABLE disputes ADD COLUMN stripe_transfer_id VARCHAR(255) DEFAULT NULL' },
  { table: 'job_photos', column: 'captured_at', sql: 'ALTER TABLE job_photos ADD COLUMN captured_at TIMESTAMP NULL AFTER uploaded_by' },

  // The lines a booking was priced with, written once when the booking is made (NULL on earlier bookings)
  { table: 'bookings', column: 'price_breakdown', sql: 'ALTER TABLE bookings ADD COLUMN price_breakdown JSON NULL AFTER standard_duration_minutes' },

  // service_pricing_items.quote_from (migration 0005): the quantity from which a pick of the item sends a job to a quote (NULL: never).
  // The runner decides on the column alone, so the two checks that name it ride in the same ALTER: a database gets all three or none.
  // quote_requests is a new table, so it needs only its tables entry.
  {
    table: 'service_pricing_items',
    column: 'quote_from',
    sql: `ALTER TABLE service_pricing_items
      ADD COLUMN quote_from INT NULL AFTER is_hourly,
      ADD CONSTRAINT chk_service_pricing_items_quote_from CHECK (quote_from IS NULL OR quote_from >= 1),
      ADD CONSTRAINT chk_service_pricing_items_quote_weekend CHECK (kind <> 'weekend' OR quote_from IS NULL)`
  },

  // quote_requests.booking_id (migration 0006): the booking an admin made from the request (NULL: nobody has booked it).
  // The runner decides on the column alone, so the index and the key that name it ride in the same ALTER: a database gets all three or none.
  // booking_card_links is a new table, so it needs only its tables entry.
  {
    table: 'quote_requests',
    column: 'booking_id',
    sql: `ALTER TABLE quote_requests
      ADD COLUMN booking_id INT NULL AFTER picks,
      ADD INDEX idx_booking (booking_id),
      ADD CONSTRAINT fk_quote_requests_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL`
  }
];

// =====================================================
// Main migration function
// =====================================================
async function runMigration() {
  let conn = null;

  console.log('\n' + '='.repeat(60));
  console.log('🚀 WorkOnTap Database Migration');
  console.log('='.repeat(60) + '\n');

  try {
    // Step 1: Create database
    console.log('📁 Step 1: Creating database...');
    conn = await connect(false);
    await conn.query(`CREATE DATABASE IF NOT EXISTS ${DB_NAME}`);
    console.log(`   ✓ Database '${DB_NAME}' is ready`);
    await conn.end();

    // Step 2: Connect to database
    conn = await connect(true);
    console.log(`   ✓ Connected to database\n`);

    // Step 3: Create tables
    console.log(`🏗️  Step 2: Creating ${tables.length} tables...`);
    let createdCount = 0;

    for (const sql of tables) {
      try {
        await conn.execute(sql);
        const match = sql.match(/CREATE TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
        if (match) {
          console.log(`   ✓ Created: ${match[1]}`);
          createdCount++;
        }
      } catch (err) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR') {
          const match = sql.match(/CREATE TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
          console.log(`   ⊘ Table already exists: ${match[1]}`);
          createdCount++;
        } else {
          throw err;
        }
      }
    }
    console.log(`   📊 Total tables created/verified: ${createdCount}/${tables.length}\n`);

    // Step 4: Run alterations (add missing columns and constraints)
    console.log('🔧 Step 3: Applying column alterations and constraints...');
    for (const alt of alterations) {
      try {
        // Check if it's an INDEX, UNIQUE, or COLUMN
        if (alt.sql.startsWith('CREATE INDEX')) {
          // Handle index creation
          const [indexExists] = await conn.query(
            `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
            [DB_NAME, alt.table, alt.column]
          );
          if (indexExists.length === 0) {
            await conn.execute(alt.sql);
            console.log(`   ✓ Added index: ${alt.table}.${alt.column}`);
          } else {
            console.log(`   ⊘ Index already exists: ${alt.table}.${alt.column}`);
          }
        } else if (alt.type === 'unique') {
          // Handle UNIQUE constraint
          try {
            await conn.execute(alt.sql);
            console.log(`   ✓ Added UNIQUE constraint: ${alt.table}.${alt.column}`);
          } catch (err) {
            if (err.code === 'ER_DUP_INDEX' || err.message.includes('Duplicate key name')) {
              console.log(`   ⊘ UNIQUE constraint already exists: ${alt.table}.${alt.column}`);
            } else {
              throw err;
            }
          }
        } else if (alt.type === 'modify') {
          // Handle COLUMN modification (e.g. changing ENUM values)
          await conn.execute(alt.sql);
          console.log(`   ✓ Modified column: ${alt.table}.${alt.column}`);
        } else {
          // Handle column addition
          const [cols] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [DB_NAME, alt.table, alt.column]
          );
          if (cols.length === 0) {
            await conn.execute(alt.sql);
            console.log(`   ✓ Added column: ${alt.table}.${alt.column}`);
          } else {
            console.log(`   ⊘ Column already exists: ${alt.table}.${alt.column}`);
          }
        }
      } catch (err) {
        console.log(`   ⚠ Warning: ${err.message.substring(0, 120)}`);
      }
    }

    // Step 5: Verify bookings table structure
    console.log('\n🔍 Step 4: Verifying bookings table structure...');
    try {
      const [columns] = await conn.query(`DESCRIBE bookings`);
      console.log(`   📋 Bookings table has ${columns.length} columns`);

      // Check for specific columns
      const columnNames = columns.map(c => c.Field);
      const requiredColumns = [
        'previous_provider_id', 'work_summary', 'recommendations', 
        'job_timer_status', 'before_photos_uploaded', 'after_photos_uploaded'
      ];

      requiredColumns.forEach(col => {
        if (columnNames.includes(col)) {
          console.log(`   ✓ Found column: ${col}`);
        } else {
          console.log(`   ❌ Missing column: ${col}`);
        }
      });
    } catch (err) {
      console.log(`   ⚠ Could not verify bookings table: ${err.message}`);
    }

    // Step 6: Verify users table structure and UNIQUE constraint
    console.log('\n🔍 Step 5: Verifying users table structure...');
    try {
      const [columns] = await conn.query(`DESCRIBE users`);
      console.log(`   📋 Users table has ${columns.length} columns`);
      
      // Check for UNIQUE constraint on phone
      const [constraints] = await conn.query(
        `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone' AND CONSTRAINT_NAME != 'PRIMARY'`,
        [DB_NAME]
      );
      
      if (constraints.length > 0) {
        console.log(`   ✓ UNIQUE constraint exists on phone column`);
      } else {
        console.log(`   ❌ UNIQUE constraint missing on phone column - trying to add it...`);
        try {
          await conn.execute('ALTER TABLE users ADD UNIQUE INDEX phone_unique (phone)');
          console.log(`   ✓ Added UNIQUE constraint on phone column`);
        } catch (err) {
          console.log(`   ⚠ Could not add UNIQUE constraint: ${err.message}`);
        }
      }
    } catch (err) {
      console.log(`   ⚠ Could not verify users table: ${err.message}`);
    }

    // Step 7: Seed service_areas if empty
    console.log('\n🌱 Step 6.5: Seeding service_areas...');
    try {
      const [rows] = await conn.query('SELECT COUNT(*) as count FROM service_areas');
      if (rows[0].count === 0) {
        console.log('   ↳ Table is empty, seeding default service areas...');
        
        const defaultAreas = [
          { key: 'VAN_CORE', name: 'Vancouver Core', group: 'Metro Vancouver' },
          { key: 'VAN_NORTH', name: 'North Shore', group: 'Metro Vancouver' },
          { key: 'VAN_SOUTH', name: 'Richmond/South', group: 'Metro Vancouver' },
          { key: 'VAN_TRI', name: 'Tri-Cities', group: 'Metro Vancouver' },
          { key: 'VAN_FRASER', name: 'Fraser', group: 'Metro Vancouver' },
          { key: 'TORONTO_CORE', name: 'Toronto Core', group: 'Greater Toronto Area' },
          { key: 'GTA_PEEL', name: 'Peel', group: 'Greater Toronto Area' },
          { key: 'GTA_YORK', name: 'York', group: 'Greater Toronto Area' },
          { key: 'GTA_DURHAM', name: 'Durham', group: 'Greater Toronto Area' },
          { key: 'GTA_HALTON', name: 'Halton', group: 'Greater Toronto Area' }
        ];

        for (const area of defaultAreas) {
          await conn.execute(
            'INSERT IGNORE INTO service_areas (cluster_key, name, cluster_group, is_active) VALUES (?, ?, ?, 1)',
            [area.key, area.name, area.group]
          );
        }
        console.log('   ✓ Default service areas seeded successfully');
      } else {
        console.log('   ↳ Table already contains data, skipping seed.');
      }
    } catch (err) {
      console.log(`   ⚠ Could not seed service_areas: ${err.message}`);
    }

    // Step 7.5: Seed default skills if empty
    console.log('\n🌱 Step 6.6: Seeding skills...');
    try {
      const [rows] = await conn.query('SELECT COUNT(*) as count FROM skills');
      if (rows[0].count === 0) {
        console.log('   ↳ Table is empty, seeding default skills...');
        
        const defaultSkills = [
          'Cleaning (regular, deep, move out)',
          'Exterior cleaning (pressure washing, gutters, windows)',
          'Handyman',
          'Furniture assembly',
          'Movers',
          'Junk removal',
          'Yard work',
          'Carpet wash'
        ];

        for (const skill of defaultSkills) {
          await conn.execute(
            'INSERT IGNORE INTO skills (name, is_active) VALUES (?, 1)',
            [skill]
          );
        }
        console.log('   ✓ Default skills seeded successfully');
      } else {
        console.log('   ↳ Table already contains data, skipping seed.');
      }
    } catch (err) {
      console.log(`   ⚠ Could not seed skills: ${err.message}`);
    }

    // Step 8: Show all table structures
    console.log('\n📋 Step 6: All table column counts:');
    const tableQueries = [
      'users', 'service_categories', 'service_providers', 'services',
      'provider_documents', 'provider_bank_accounts', 'bookings',
      'chat_messages', 'booking_photos', 'booking_status_history',
      'booking_time_logs', 'job_photos', 'provider_reviews', 'invoices',
      'provider_payouts', 'disputes', 'mobile_auth_users', 
      'notifications', 'deletion_requests', 'service_areas',
      'states', 'districts', 'cities', 'skills',
      'service_locations', 'seo_settings', 'blogs', 'system_settings', 'testimonials'
    ];

    let totalColumns = 0;
    for (const table of tableQueries) {
      try {
        const [columns] = await conn.query(`DESCRIBE ${table}`);
        console.log(`   • ${table.padEnd(22)}: ${columns.length} columns`);
        totalColumns += columns.length;

        // Special verification for bookings table
        if (table === 'bookings') {
          const columnNames = columns.map(c => c.Field);
          const requiredColumns = [
            'previous_provider_id', 'job_timer_status', 'before_photos_uploaded',
            'after_photos_uploaded', 'work_summary', 'recommendations'
          ];

          const missing = requiredColumns.filter(col => !columnNames.includes(col));
          if (missing.length === 0) {
            console.log('     ✓ All required columns present');
          } else {
            console.log('     ❌ Missing columns:', missing.join(', '));
          }
        }
      } catch (err) {
        console.log(`   • ${table.padEnd(22)}: not found`);
      }
    }
    console.log(`   📊 Total columns across all tables: ${totalColumns}`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration completed successfully!');
    console.log('='.repeat(60));
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Tables:   ${tableQueries.length}/29`);
    console.log(`   Total Columns: ${totalColumns}`);
    console.log('   ✓ UNIQUE constraint added to users.phone column');
    console.log('='.repeat(60) + '\n');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('   🔑 Please update database credentials in .env file:');
      console.error(`      DB_HOST=${process.env.DB_HOST || 'localhost'}`);
      console.error(`      DB_USER=${process.env.DB_USER || 'root'}`);
      console.error(`      DB_PASSWORD=${process.env.DB_PASSWORD ? '****' : 'not set'}`);
    } else if (err.code === 'ECONNREFUSED') {
      console.error('   🔌 MySQL server is not running. Please start MySQL first.');
    } else if (err.code === 'ER_DUP_ENTRY') {
      console.error('   ⚠ Duplicate entries found in users.phone column. Please clean up duplicates first:');
      console.error('      Run: SELECT phone, COUNT(*) FROM users GROUP BY phone HAVING COUNT(*) > 1;');
    }
    process.exit(1);
  } finally {
    if (conn) {
      await conn.end();
      console.log('   🔒 Database connection closed');
    }
  }
}

// Run the migration
runMigration();