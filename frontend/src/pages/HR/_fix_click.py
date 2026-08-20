path = 'Hr.jsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = """else if (title === 'Holiday Calendar') {
    setView('holiday_calendar');
}
    else {
      console.log(`Navigating to ${title}`);
    }"""
new = """else if (title === 'Holiday Calendar') {
    setView('holiday_calendar');
  }
  else if (title === 'Biometric Attendance') {
    setView('biometric_attendance');
  }
    else {
      console.log(`Navigating to ${title}`);
    }"""
assert content.count(old) == 1, 'anchor count=%d' % content.count(old)
content = content.replace(old, new)

with open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(content)
print('OK')
