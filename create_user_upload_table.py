
import os
import subprocess
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Get the database URL from environment variables
database_url = os.getenv('DATABASE_URL')

if not database_url:
    print("Error: DATABASE_URL environment variable not found")
    exit(1)

# SQL command to create the user_upload table
create_table_sql = """
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
);

CREATE INDEX IF NOT EXISTS idx_user_upload_user_id ON user_upload (user_id);
"""

# Create a temporary SQL file
with open('temp_migration.sql', 'w') as f:
    f.write(create_table_sql)

try:
    # Execute the SQL using psql
    subprocess.run(['psql', database_url, '-f', 'temp_migration.sql'], check=True)
    print("Migration completed successfully: user_upload table created")
except subprocess.CalledProcessError as e:
    print(f"Error executing migration: {e}")
finally:
    # Clean up temporary file
    if os.path.exists('temp_migration.sql'):
        os.remove('temp_migration.sql')
