path = 'BiometricAttendance.jsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace EMPTY_FILTERS and add current month helper
old = '''const EMPTY_FILTERS = {
  month: '',
  date: '',
  start: '',
  end: '',
  emp_id: '',
  emp_type: '',
  circle: '',
  device_sn: '',
};'''
new = '''const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const EMPTY_FILTERS = {
  month: currentMonth(),
  date: '',
  start: '',
  end: '',
  emp_id: '',
};'''
assert content.count(old) == 1, 'EMPTY_FILTERS anchor=%d' % content.count(old)
content = content.replace(old, new)

# 2. Remove unused props and device state
old = '''export function BiometricAttendance({ onBack, empTypeOptions = [], circleOptions = [] }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devices, setDevices] = useState([]);
  const [detail, setDetail] = useState(null);'''
new = '''export function BiometricAttendance({ onBack }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);'''
assert content.count(old) == 1, 'props anchor=%d' % content.count(old)
content = content.replace(old, new)

# 3. Remove emp_type/circle/device_sn from buildParams
old = '''      if (filters.emp_id) params.set('emp_id', filters.emp_id);
      if (filters.emp_type) params.set('emp_type', filters.emp_type);
      if (filters.circle) params.set('circle', filters.circle);
      if (filters.device_sn) params.set('device_sn', filters.device_sn);'''
new = '''      if (filters.emp_id) params.set('emp_id', filters.emp_id);'''
assert content.count(old) == 1, 'buildParams anchor=%d' % content.count(old)
content = content.replace(old, new)

# 4. Remove fetchDevices and its useEffect
old = '''  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/devices`, { headers: getAuthHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) setDevices(data.devices || []);
    } catch {
      /* ignore device list errors */
    }
  }, []);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  useEffect(() => {'''
new = '''  useEffect(() => {'''
assert content.count(old) == 1, 'fetchDevices anchor=%d' % content.count(old)
content = content.replace(old, new)

# 5. Remove Department, Circle, Device filter JSX blocks
old = '''        <label>
          Department
          <select
            value={filters.emp_type}
            onChange={(e) => handleFilterChange('emp_type', e.target.value)}
          >
            <option value="">All</option>
            {empTypeOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          Circle
          <select
            value={filters.circle}
            onChange={(e) => handleFilterChange('circle', e.target.value)}
          >
            <option value="">All</option>
            {circleOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Device
          <select
            value={filters.device_sn}
            onChange={(e) => handleFilterChange('device_sn', e.target.value)}
          >
            <option value="">All</option>
            {devices.map((d) => (
              <option key={d.serial_number} value={d.serial_number}>
                {d.name || d.serial_number}
              </option>
            ))}
          </select>
        </label>'''
new = ''
assert content.count(old) == 1, 'filter JSX anchor=%d' % content.count(old)
content = content.replace(old, new)

# 6. Remove emp_type/circle/device_sn from export URL builder
old = '''      if (filters.emp_id) params.set('emp_id', filters.emp_id);
      if (filters.emp_type) params.set('emp_type', filters.emp_type);
      if (filters.circle) params.set('circle', filters.circle);
      if (filters.device_sn) params.set('device_sn', filters.device_sn);'''
# Need to be careful - this same block appears. After buildParams edit, only export remains.
new = '''      if (filters.emp_id) params.set('emp_id', filters.emp_id);'''
assert content.count(old) == 1, 'export anchor=%d' % content.count(old)
content = content.replace(old, new)

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(content)
print('OK')
