// src/data/requests.js

const requests = [
  {
    id: 1,
    employeeName: "Amit Sharma",
    type: "Leave",
    duration: "2 Days",
    reason: "Family function",
    status: "Pending",
    appliedOn: "12 Jan 2025",
    from: "15 Jan 2025",
    to: "18 Jan 2025",
    documents: [
      "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    ]
  },
  {
    id: 2,
    employeeName: "Neha Verma",
    type: "Claim",
    duration: "₹3,200",
    status: "Pending",
    appliedOn: "10 Jan 2025",
    details: {
      "Designation": "Software Engineer",
      "Employee ID": "EMP-402",
      "Email": "nverma@sghaam.com",
      "Project Name": "Alpha-Tech CMS",
      "Country/State": "Maharashtra, India",
      "Travel From": "08-01-2025",
      "Travel To": "10-01-2025"
    },
    expenses: [
      { id: "e1", date: "08-01-2025", description: "Airport Taxi (Home to BOM)", currency: "INR", amount: "1200", status: "Pending" },
      { id: "e2", date: "09-01-2025", description: "Client Dinner - Business Meet", currency: "INR", amount: "2000", status: "Pending" },
      /* ✅ NEW DATA ADDED FOR PAGINATION TESTING */
      { id: "e3", date: "09-01-2025", description: "Hotel Stay - Night 1", currency: "INR", amount: "4500", status: "Pending" },
      { id: "e4", date: "10-01-2025", description: "Local Conveyance - Auto", currency: "INR", amount: "150", status: "Pending" },
      { id: "e5", date: "10-01-2025", description: "Breakfast Expense", currency: "INR", amount: "350", status: "Pending" },
      { id: "e6", date: "11-01-2025", description: "Stationery for Workshop", currency: "INR", amount: "800", status: "Pending" },
      { id: "e7", date: "11-01-2025", description: "Team Lunch", currency: "INR", amount: "5200", status: "Pending" },
      { id: "e8", date: "12-01-2025", description: "Courier Charges", currency: "INR", amount: "120", status: "Pending" },
      { id: "e9", date: "12-01-2025", description: "Return Taxi (BOM to Home)", currency: "INR", amount: "1100", status: "Pending" },
      { id: "e10", date: "13-01-2025", description: "Internet Reimbursement", currency: "INR", amount: "1000", status: "Pending" },
      { id: "e11", date: "13-01-2025", description: "Software Subscription", currency: "INR", amount: "2500", status: "Pending" },
      { id: "e12", date: "14-01-2025", description: "Miscellaneous Park Fee", currency: "INR", amount: "50", status: "Pending" }
    ],
    documents: [
      "https://pdfobject.com/pdf/sample.pdf",
      "https://raw.githubusercontent.com/mdn/learning-area/master/html/multimedia-and-embedding/images-in-html/dinosaur_small.jpg"
    ]
  },
  {
    id: 3,
    employeeName: "Rahul Singh",
    type: "WFH",
    duration: "1 Day",
    reason: "Internet maintenance",
    status: "Pending",
    appliedOn: "15 Jan 2025",
    documents: []
  },
  {
    id: 5,
    employeeName: "Verma",
    type: "Claim",
    duration: "₹1,500",
    status: "Pending",
    appliedOn: "22 Jan 2025",
    details: {
      "Designation": "HR Manager",
      "Employee ID": "EMP-109",
      "Email": "wwwwmsjs.gmail",
      "Project Name": "Internal Hiring",
      "Country/State": "Delhi, India",
      "Travel From": "20-01-2025",
      "Travel To": "20-01-2025"
    },
    expenses: [
      { 
        id: "v1", 
        date: "20-01-2025", 
        description: "Office Stationery Purchase", 
        currency: "INR",
        amount: "1500", 
        status: "Pending" 
      }
    ],
    documents: [
      "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    ]
  }
];

export default requests;