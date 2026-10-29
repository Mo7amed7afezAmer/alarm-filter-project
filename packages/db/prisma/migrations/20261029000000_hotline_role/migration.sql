-- HOTLINE: every office and the super admin's powers except the settings for everyone.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HOTLINE' BEFORE 'SUPER_ADMIN';
