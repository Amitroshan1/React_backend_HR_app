import { Dashboard } from "./pages/Dashboard/Dashboard";
import { HomePage } from "./pages/HomePage";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Attendance } from "./pages/Attendance/Attendance";
import { Wfh } from "./pages/Wfh/Wfh";
import { Salary } from "./pages/Salary/Salary";
import { Leaves } from "./pages/Leaves/Leaves";
import { Profile } from "./pages/Profile/components/Profile";
// import { Profile } from "./pages/Profile/Profile";
import { AppLayout } from "./components/layout/AppLayout";
import { UserProvider } from "./components/layout/UserContext";
import { Queries } from "./pages/Query/Queries";
import { Claims } from "./pages/Claims/Claims";
import { Hr } from "./pages/HR/Hr";
import { Account } from "./pages/Account/Account";
import {Admin} from "./pages/Admin/Admin";
import { Manager } from "./pages/Manager/Manager";
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
        { path: "queries", element: <Queries /> },
        { path: "claims", element: <Claims /> },
         { path: "wfh", element: <Wfh /> },
            { path: "account", element: <Account /> },
            { path: "hr", element: <Hr /> },
            {path: "admin", element:<Admin/>},
{path:"manager", element:<Manager/>}
      ]
    }
  ]);
  return (
    <UserProvider>
      <RouterProvider router={router} />
    </UserProvider>
  )
};
