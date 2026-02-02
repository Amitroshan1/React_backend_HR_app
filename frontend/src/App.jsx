// import {Sidebar} from "./pages/Sidebar";
// import { Dashboard } from "./pages/Dashboard";
// import { HomePage } from "./pages/HomePage";
// import { BrowserRouter, Routes, Route } from "react-router-dom";
// export const App = () => {
//   return (

//      <BrowserRouter>
//       <Routes>
//         <Route path="/" element={<HomePage />} />
//         <Route path="/dashboard" element={<Dashboard />} />
//       </Routes>
//     </BrowserRouter>
//     // <HomePage/>
//     // <div style={{ display: "flex" }}>
//     //   <Sidebar />

//     //   <div style={{ marginLeft: "250px", padding: "20px" }}>
//     //    <Dashboard/>
//     //   </div>
//     // </div>
//   );
// }






import { Dashboard } from "./pages/Dashboard";
import { HomePage } from "./pages/HomePage";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Attendance } from "./pages/Attendance/Attendance";
import { Salary } from "./pages/Salary/Salary";
import { Leaves } from "./pages/Leaves/Leaves";
import { Profile } from "./pages/Profile/Profile";
import { AppLayout } from "./components/layout/AppLayout";
import { UserProvider } from "./components/layout/UserContext";
export const App = () => {
  const router = createBrowserRouter ([

{
 path:"/" ,
 element:<HomePage />,
 },
 
//  {
//     path:"/dashboard",
//     element:<Dashboard />,
//           },
// {
//    path:"/attendance",
//     element:<Attendance />
//   }, 
// {
//   path:"/salary", element:<Salary/>},
// {
//   path:"/leaves", element:<Leaves />} ,
// { path:"/profile", element:<Profile />} ,
 

{
            path: "/", 
            element: <AppLayout />, // <--- Layout component
            children: [
                // Use index: true for the default route if you want / to render Dashboard 
                // when AppLayout is active. Otherwise, keep your current structure:
                { path:"dashboard", element:<Dashboard /> },
                { path:"attendance", element:<Attendance /> }, 
                { path:"salary", element:<Salary/> },
                { path:"leaves", element:<Leaves /> },
                { path:"profile", element:<Profile /> },
            ]
        }
]);
return (
  <UserProvider>
            <RouterProvider router={router}/>
        </UserProvider>
)
};
