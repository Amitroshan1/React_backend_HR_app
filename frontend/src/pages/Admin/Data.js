// Import employee photos
import emp1 from "./photos/emp1.jpg";
import emp2 from "./photos/emp2.jpg";
import emp3 from "./photos/emp3.jpg";
import emp4 from "./photos/emp4.jpg";
import emp5 from "./photos/emp5.jpg";
import emp6 from "./photos/emp6.jpg";
import emp7 from "./photos/emp7.jpg";
import emp8 from "./photos/emp8.jpg";
import emp9 from "./photos/emp9.jpg";
import emp10 from "./photos/emp10.jpg";

export const employeesData = [
  {
    id: "EMP001",
    name: "John Smith",
    email: "john.smith@company.com",
    designation: "Engineer",
    phone: "+1 234-567-8901",
    gender: "Male",
    dob: "1990-05-15",
    address: "123 Main St, New York, NY 10001",
    circle: "North",
    photo: emp1,
    leaves: [
      { id: "L001", type: "Sick Leave", status: "Approved", startDate: "2024-01-10", endDate: "2024-01-12" },
      { id: "L002", type: "Casual Leave", status: "Pending", startDate: "2024-02-20", endDate: "2024-02-21" }
    ],
    claims: [
      { id: "C001", type: "Travel", status: "Approved", startDate: "2024-01-05", endDate: "2024-01-05" },
      { id: "C002", type: "Medical", status: "Pending", startDate: "2024-02-15", endDate: "2024-02-15" }
    ],
    queries: [
      { id: "Q001", type: "Salary", status: "Resolved", startDate: "2024-01-20", endDate: "2024-01-22" }
    ],
    resignations: [],
    punches: [
      { id: "P001", type: "Check-in", status: "Approved", startDate: "2024-02-01", endDate: "2024-02-01" },
      { id: "P002", type: "Check-out", status: "Approved", startDate: "2024-02-01", endDate: "2024-02-01" }
    ],
    payslips: [
      { id: "PS001", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A001", type: "Laptop", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP002",
    name: "Sarah Johnson",
    email: "sarah.johnson@company.com",
    designation: "HR",
    phone: "+1 234-567-8902",
    gender: "Female",
    dob: "1988-08-22",
    address: "456 Oak Ave, Chicago, IL 60601",
    circle: "South",
    photo: emp2,
    leaves: [
      { id: "L003", type: "Annual Leave", status: "Approved", startDate: "2024-01-15", endDate: "2024-01-20" }
    ],
    claims: [
      { id: "C003", type: "Food", status: "Approved", startDate: "2024-01-08", endDate: "2024-01-08" }
    ],
    queries: [
      { id: "Q002", type: "Policy", status: "Pending", startDate: "2024-02-10", endDate: "2024-02-10" },
      { id: "Q003", type: "Benefits", status: "Approved", startDate: "2024-01-25", endDate: "2024-01-26" }
    ],
    resignations: [],
    punches: [
      { id: "P003", type: "Check-in", status: "Approved", startDate: "2024-02-02", endDate: "2024-02-02" }
    ],
    payslips: [
      { id: "PS002", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A002", type: "Phone", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP003",
    name: "Michael Chen",
    email: "michael.chen@company.com",
    designation: "Engineer",
    phone: "+1 234-567-8903",
    gender: "Male",
    dob: "1992-03-10",
    address: "789 Pine Rd, San Francisco, CA 94102",
    circle: "West",
    photo: emp3,
    leaves: [
      { id: "L004", type: "Sick Leave", status: "Rejected", startDate: "2024-02-05", endDate: "2024-02-06" }
    ],
    claims: [
      { id: "C004", type: "Travel", status: "Pending", startDate: "2024-02-18", endDate: "2024-02-18" },
      { id: "C005", type: "Medical", status: "Approved", startDate: "2024-01-12", endDate: "2024-01-12" }
    ],
    queries: [],
    resignations: [],
    punches: [
      { id: "P004", type: "Check-in", status: "Approved", startDate: "2024-02-03", endDate: "2024-02-03" }
    ],
    payslips: [
      { id: "PS003", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A003", type: "Laptop", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" },
      { id: "A004", type: "Monitor", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP004",
    name: "Emily Davis",
    email: "emily.davis@company.com",
    designation: "Accountant",
    phone: "+1 234-567-8904",
    gender: "Female",
    dob: "1991-11-30",
    address: "321 Elm St, Boston, MA 02101",
    circle: "East",
    photo: emp4,
    leaves: [
      { id: "L005", type: "Casual Leave", status: "Approved", startDate: "2024-01-22", endDate: "2024-01-23" },
      { id: "L006", type: "Annual Leave", status: "Pending", startDate: "2024-03-01", endDate: "2024-03-05" }
    ],
    claims: [
      { id: "C006", type: "Food", status: "Approved", startDate: "2024-01-30", endDate: "2024-01-30" }
    ],
    queries: [
      { id: "Q004", type: "Tax", status: "Approved", startDate: "2024-02-01", endDate: "2024-02-03" }
    ],
    resignations: [],
    punches: [
      { id: "P005", type: "Check-in", status: "Approved", startDate: "2024-02-04", endDate: "2024-02-04" }
    ],
    payslips: [
      { id: "PS004", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A005", type: "Calculator", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP005",
    name: "David Wilson",
    email: "david.wilson@company.com",
    designation: "Engineer",
    phone: "+1 234-567-8905",
    gender: "Male",
    dob: "1989-07-18",
    address: "654 Maple Dr, Seattle, WA 98101",
    circle: "West",
    photo: emp5,
    leaves: [
      { id: "L007", type: "Sick Leave", status: "Approved", startDate: "2024-01-28", endDate: "2024-01-30" }
    ],
    claims: [
      { id: "C007", type: "Travel", status: "Rejected", startDate: "2024-01-18", endDate: "2024-01-18" }
    ],
    queries: [
      { id: "Q005", type: "Project", status: "Pending", startDate: "2024-02-08", endDate: "2024-02-08" }
    ],
    resignations: [
      { id: "R001", type: "Voluntary", status: "Pending", startDate: "2024-02-15", endDate: "2024-03-15" }
    ],
    punches: [
      { id: "P006", type: "Check-in", status: "Approved", startDate: "2024-02-05", endDate: "2024-02-05" }
    ],
    payslips: [
      { id: "PS005", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A006", type: "Laptop", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP006",
    name: "Jessica Martinez",
    email: "jessica.martinez@company.com",
    designation: "HR",
    phone: "+1 234-567-8906",
    gender: "Female",
    dob: "1993-04-25",
    address: "987 Cedar Ln, Miami, FL 33101",
    circle: "South",
    photo: emp6,
    leaves: [
      { id: "L008", type: "Casual Leave", status: "Pending", startDate: "2024-02-25", endDate: "2024-02-26" }
    ],
    claims: [
      { id: "C008", type: "Medical", status: "Approved", startDate: "2024-01-20", endDate: "2024-01-20" },
      { id: "C009", type: "Food", status: "Pending", startDate: "2024-02-12", endDate: "2024-02-12" }
    ],
    queries: [
      { id: "Q006", type: "Leave Balance", status: "Approved", startDate: "2024-01-15", endDate: "2024-01-16" }
    ],
    resignations: [],
    punches: [
      { id: "P007", type: "Check-in", status: "Approved", startDate: "2024-02-06", endDate: "2024-02-06" }
    ],
    payslips: [
      { id: "PS006", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A007", type: "Phone", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP007",
    name: "Robert Taylor",
    email: "robert.taylor@company.com",
    designation: "Accountant",
    phone: "+1 234-567-8907",
    gender: "Male",
    dob: "1987-12-08",
    address: "147 Birch St, Philadelphia, PA 19101",
    circle: "East",
    photo: emp7,
    leaves: [
      { id: "L009", type: "Annual Leave", status: "Approved", startDate: "2024-02-10", endDate: "2024-02-14" }
    ],
    claims: [
      { id: "C010", type: "Travel", status: "Approved", startDate: "2024-01-25", endDate: "2024-01-25" }
    ],
    queries: [
      { id: "Q007", type: "Reimbursement", status: "Rejected", startDate: "2024-02-05", endDate: "2024-02-06" }
    ],
    resignations: [],
    punches: [
      { id: "P008", type: "Check-in", status: "Approved", startDate: "2024-02-07", endDate: "2024-02-07" }
    ],
    payslips: [
      { id: "PS007", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A008", type: "Laptop", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP008",
    name: "Amanda White",
    email: "amanda.white@company.com",
    designation: "Engineer",
    phone: "+1 234-567-8908",
    gender: "Female",
    dob: "1994-09-12",
    address: "258 Willow Way, Denver, CO 80201",
    circle: "West",
    photo: emp8,
    leaves: [
      { id: "L010", type: "Sick Leave", status: "Pending", startDate: "2024-02-22", endDate: "2024-02-23" },
      { id: "L011", type: "Casual Leave", status: "Approved", startDate: "2024-01-18", endDate: "2024-01-19" }
    ],
    claims: [
      { id: "C011", type: "Medical", status: "Pending", startDate: "2024-02-20", endDate: "2024-02-20" }
    ],
    queries: [
      { id: "Q008", type: "Training", status: "Approved", startDate: "2024-01-28", endDate: "2024-01-30" }
    ],
    resignations: [],
    punches: [
      { id: "P009", type: "Check-in", status: "Approved", startDate: "2024-02-08", endDate: "2024-02-08" }
    ],
    payslips: [
      { id: "PS008", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A009", type: "Laptop", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" },
      { id: "A010", type: "Headphones", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP009",
    name: "Christopher Lee",
    email: "christopher.lee@company.com",
    designation: "HR",
    phone: "+1 234-567-8909",
    gender: "Male",
    dob: "1990-06-20",
    address: "369 Spruce Ave, Detroit, MI 48201",
    circle: "North",
    photo: emp9,
    leaves: [
      { id: "L012", type: "Annual Leave", status: "Rejected", startDate: "2024-02-28", endDate: "2024-03-02" }
    ],
    claims: [
      { id: "C012", type: "Food", status: "Approved", startDate: "2024-02-05", endDate: "2024-02-05" }
    ],
    queries: [
      { id: "Q009", type: "Policy Change", status: "Pending", startDate: "2024-02-12", endDate: "2024-02-12" },
      { id: "Q010", type: "Promotion", status: "Approved", startDate: "2024-01-10", endDate: "2024-01-15" }
    ],
    resignations: [],
    punches: [
      { id: "P010", type: "Check-in", status: "Approved", startDate: "2024-02-09", endDate: "2024-02-09" }
    ],
    payslips: [
      { id: "PS009", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A011", type: "Phone", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  },
  {
    id: "EMP010",
    name: "Lisa Anderson",
    email: "lisa.anderson@company.com",
    designation: "Accountant",
    phone: "+1 234-567-8910",
    gender: "Female",
    dob: "1992-02-14",
    address: "741 Ash Blvd, Atlanta, GA 30301",
    circle: "South",
    photo: emp10,
    leaves: [
      { id: "L013", type: "Casual Leave", status: "Approved", startDate: "2024-01-25", endDate: "2024-01-26" }
    ],
    claims: [
      { id: "C013", type: "Travel", status: "Approved", startDate: "2024-01-15", endDate: "2024-01-15" },
      { id: "C014", type: "Medical", status: "Rejected", startDate: "2024-02-08", endDate: "2024-02-08" }
    ],
    queries: [
      { id: "Q011", type: "Invoice", status: "Approved", startDate: "2024-02-02", endDate: "2024-02-04" }
    ],
    resignations: [],
    punches: [
      { id: "P011", type: "Check-in", status: "Approved", startDate: "2024-02-10", endDate: "2024-02-10" }
    ],
    payslips: [
      { id: "PS010", type: "Monthly", status: "Approved", startDate: "2024-01-31", endDate: "2024-01-31" }
    ],
    assets: [
      { id: "A012", type: "Laptop", status: "Approved", startDate: "2024-01-01", endDate: "2024-12-31" }
    ]
  }
];