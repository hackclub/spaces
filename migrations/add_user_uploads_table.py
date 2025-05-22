
from app import app, db
from sqlalchemy import text
import os

def run_migration():
    """Add the user_upload table to the database."""
    with app.app_context():
        print("Running migration: add_user_uploads_table")
        
        # Check if table already exists
        result = db.session.execute(text("SELECT to_regclass('user_upload')"))
        table_exists = result.scalar() is not None
        
        if table_exists:
            print("Table 'user_upload' already exists, skipping migration")
            return
        
        # Create the table
        db.session.execute(text("""
        CREATE TABLE IF NOT EXISTS user_upload (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
            filename VARCHAR(255) NOT NULL,
            original_filename VARCHAR(255) NOT NULL,
            file_type VARCHAR(50),
            file_size INTEGER,
            cdn_url VARCHAR(500) NOT NULL,
            uploaded_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            sha VARCHAR(100)
        )
        """))
        
        # Create index on user_id for faster lookups
        db.session.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_user_upload_user_id ON user_upload (user_id)
        """))
        
        # Commit the changes
        db.session.commit()
        
        print("Migration completed successfully")

if __name__ == "__main__":
    run_migration()
