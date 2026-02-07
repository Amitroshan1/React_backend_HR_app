# Location Database Setup Instructions

## Database Table: `location`

To enable location-based punch-in/out validation, you need to add a location entry in the `location` table.

### Table Structure

The `location` table has the following columns:
- `id` (Integer, Primary Key, Auto-increment)
- `name` (String, 100 characters, Required) - Name of the office location
- `latitude` (Float, Required) - Latitude coordinate of the office
- `longitude` (Float, Required) - Longitude coordinate of the office
- `radius` (Float, Default: 100) - Allowed radius in meters from the office location

### How to Get Latitude and Longitude

1. **Using Google Maps:**
   - Open Google Maps
   - Navigate to your office location
   - Right-click on the exact location
   - Click on the coordinates that appear (e.g., "19.0760, 72.8777")
   - The first number is latitude, the second is longitude

2. **Using GPS Coordinates:**
   - Use a GPS device or mobile app at your office location
   - Note down the latitude and longitude values

### Example SQL Insert Statement

```sql
INSERT INTO location (name, latitude, longitude, radius) 
VALUES ('Main Office', 19.0760, 72.8777, 100);
```

### Recommended Values

- **Name**: A descriptive name for your office location (e.g., "Main Office", "Headquarters", "Branch Office - Mumbai")
- **Latitude**: Your office's latitude coordinate (e.g., 19.0760 for Mumbai)
- **Longitude**: Your office's longitude coordinate (e.g., 72.8777 for Mumbai)
- **Radius**: Distance in meters from the office location where employees can punch in/out
  - **Recommended**: 100 meters (default)
  - **For larger offices**: 200-500 meters
  - **For strict location**: 50 meters

### Example for Different Cities

**Mumbai, India:**
```sql
INSERT INTO location (name, latitude, longitude, radius) 
VALUES ('Mumbai Office', 19.0760, 72.8777, 100);
```

**Delhi, India:**
```sql
INSERT INTO location (name, latitude, longitude, radius) 
VALUES ('Delhi Office', 28.6139, 77.2090, 100);
```

**Bangalore, India:**
```sql
INSERT INTO location (name, latitude, longitude, radius) 
VALUES ('Bangalore Office', 12.9716, 77.5946, 100);
```

### How It Works

1. When an employee tries to punch in/out, the system:
   - Gets the employee's current GPS location
   - Calculates the distance between employee's location and the office location
   - If the distance is **within the radius**, punch in/out is allowed
   - If the distance is **greater than the radius**, punch in/out is **blocked** with an error message

2. The error message will show: `"Too far from office location (XXXm > YYYm)"`

### Important Notes

- Only **one location** is currently used (the first record in the table)
- If you have multiple office locations, you may need to modify the backend to select location based on employee's `circle` or other criteria
- The radius is in **meters** (not kilometers or miles)
- Location services must be enabled on the employee's device for punch in/out to work

### Verification

After inserting the location, verify it exists:
```sql
SELECT * FROM location;
```

You should see your location entry with the correct coordinates and radius.
