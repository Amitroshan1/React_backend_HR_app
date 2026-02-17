import { Dashboard } from "./pages/Dashboard/Dashboard";
import { HomePage } from "./pages/HomePage";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Attendance } from "./pages/Attendance/Attendance";
import { Wfh } from "./pages/Wfh/Wfh";
import { Salary } from "./pages/Salary/Salary";
import { Leaves } from "./pages/Leaves/Leaves";
import { Profile } from "./pages/Profile/components/Profile";
import ChangePassword from "./pages/Profile/ChangePassword";
import { AppLayout } from "./components/layout/AppLayout";
import { UserProvider } from "./components/layout/UserContext";
import { Queries } from "./pages/Query/Queries";
import { DepartmentQueryInbox } from "./pages/Query/DepartmentQueryInbox";
import { Claims } from "./pages/Claims/Claims";
import { Separation } from "./pages/Separation/Separation";
import { Hr } from "./pages/HR/Hr";
import { Account } from "./pages/Account/Account";
import Admin from "./pages/Admin/Admin";
import { Manager } from "./pages/Manager/Manager";
import { ITPanel } from "./pages/IT/ITPanel";
import ArchiveEmployees from "./pages/HR/Archive/Archive";
import ExitEmployee from "./pages/HR/ExitEmployee";
import { EmployeePerformance } from "./pages/Performance/EmployeePerformance";
import { ManagerPerformanceReviews } from "./pages/Manager/ManagerPerformanceReviews";
import { HolidayCalendarUser } from "./pages/Holiday/HolidayCalendarUser";

// Employee Management System Components
import Employee from "./pages/Admin/Employee";
import EmployeeDetails from "./pages/Admin/EmployeeDetails";

// Initialize localStorage on app start - clear old test data
const isFirstLoad = !localStorage.getItem('_appInitialized');
if (isFirstLoad) {
  localStorage.setItem('archivedEmployees', JSON.stringify([]));
  localStorage.setItem('_appInitialized', 'true');
}

export const App = () => {
  const router = createBrowserRouter([
    {
      path: "/",
      element: <HomePage />,
    },
    {
      path: "/",
      element: <AppLayout />,
      children: [
        { path: "dashboard", element: <Dashboard /> },
        { path: "attendance", element: <Attendance /> },
        { path: "salary", element: <Salary /> },
        { path: "leaves", element: <Leaves /> },
        { path: "profile", element: <Profile /> },
        { path: "change-password", element: <ChangePassword /> },
        { path: "queries", element: <Queries /> },
        { path: "queries/inbox", element: <DepartmentQueryInbox /> },
        { path: "claims", element: <Claims /> },
        { path: "separation", element: <Separation /> },
        { path: "wfh", element: <Wfh /> },
        { path: "performance", element: <EmployeePerformance /> },
        { path: "holiday-calendar", element: <HolidayCalendarUser /> },
        { path: "account", element: <Account /> },
        { path: "hr", element: <Hr /> },
        { path: "updates", element: <Hr /> },
        { path: "archive-employees", element: <ArchiveEmployees /> },
        { path: "exit-employees", element: <ExitEmployee /> },
        { path: "admin", element: <Admin /> },
        { path: "manager", element: <Manager /> },
        { path: "manager/performance-reviews", element: <ManagerPerformanceReviews /> },
        { path: "it", element: <ITPanel /> },
        { path: "employees", element: <Employee /> },
        { path: "employee/:id", element: <EmployeeDetails /> },
      ]
    }
  ]);

  return (
    <UserProvider>
      <RouterProvider router={router} />
    </UserProvider>
  );
};





// import { Dashboard } from "./pages/Dashboard/Dashboard";
// import { HomePage } from "./pages/HomePage";
// import { createBrowserRouter, RouterProvider } from "react-router-dom";
// import { Attendance } from "./pages/Attendance/Attendance";
// import { Wfh } from "./pages/Wfh/Wfh";
// import { Salary } from "./pages/Salary/Salary";
// import { Leaves } from "./pages/Leaves/Leaves";
// import { Profile } from "./pages/Profile/components/Profile";
// // import { Profile } from "./pages/Profile/Profile";
// import { AppLayout } from "./components/layout/AppLayout";
// import { UserProvider } from "./components/layout/UserContext";
// import { Queries } from "./pages/Query/Queries";
// import { Claims } from "./pages/Claims/Claims";
// import { Separation } from "./pages/Separation/Separation";
// import { Hr } from "./pages/HR/Hr";
// import { Account } from "./pages/Account/Account";
// import {Admin} from "./pages/Admin/Admin";
// import { Manager } from "./pages/Manager/Manager";
// import { ITPanel } from "./pages/IT/ITPanel";
// //Added by me
// import ArchiveEmployees from "./pages/HR/Archive/Archive";
// import ExitEmployee from "./pages/HR/ExitEmployee"; 



// // Initialize localStorage on app start - clear old test data
// // This will clear old data one time and then mark as initialized
// const isFirstLoad = !localStorage.getItem('_appInitialized');
// if (isFirstLoad) {
//   localStorage.setItem('archivedEmployees', JSON.stringify([]));
//   localStorage.setItem('_appInitialized', 'true');
// }


// export const App = () => {
//   const router = createBrowserRouter([

//     {
//       path: "/",
//       element: <HomePage />,
//     },

//     // Note: archive & exit are now children of AppLayout so they render inside the shared layout

//     {
//       path: "/",
//       element: <AppLayout />,
//       children: [
//         { path: "dashboard", element: <Dashboard /> },
//         { path: "attendance", element: <Attendance /> },
//         { path: "salary", element: <Salary /> },
//         { path: "leaves", element: <Leaves /> },
//         { path: "profile", element: <Profile /> },
//         { path: "queries", element: <Queries /> },
//         { path: "claims", element: <Claims /> },
//         { path: "separation", element: <Separation /> },
//         { path: "wfh", element: <Wfh /> },
//         { path: "account", element: <Account /> },
//         { path: "hr", element: <Hr /> },
//         { path: "updates", element: <Hr /> },
//         { path: "archive-employees", element: <ArchiveEmployees /> },
//         { path: "exit-employees", element: <ExitEmployee /> },
//         { path: "admin", element: <Admin/> },
//         { path: "manager", element: <Manager/> },
//         { path: "it", element: <ITPanel/> }
//       ]
//     }
//   ]);
//   return (
//     <UserProvider>
//       <RouterProvider router={router} />
//     </UserProvider>
//   )
// };
