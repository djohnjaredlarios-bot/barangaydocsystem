-- Create a dedicated database user for the Barangay app
-- Run this as a MySQL root or admin user.

CREATE USER IF NOT EXISTS 'barangay_user'@'localhost' IDENTIFIED BY 'YourStrongPassword';
GRANT ALL PRIVILEGES ON barangay_system.* TO 'barangay_user'@'localhost';
FLUSH PRIVILEGES;
