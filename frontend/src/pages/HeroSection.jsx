// import { useState, useEffect } from "react";

// import "./style/HeroSection.css";
// export const HeroSection = () => {
// const [animate, setAnimate] = useState(true);

//   useEffect(() => {
//     const interval = setInterval(() => {
//       setAnimate(false);
//       setTimeout(() => setAnimate(true), 50);
//     }, 3000);

//     return () => clearInterval(interval);
//   }, []);

//   return (
//     <div className="index-container">
//       {/* Decorative background elements */}
//       <div className="background-elements">
//         <div className="bg-circle-1" />
//         <div className="bg-circle-2" />
//       </div>

//       {/* Main Content */}
//       <main className="main-content">
//         <div className="hero-container">
//           {/* Hero Text */}
//           <div className="hero-text">
//             {/* <h1 className="hero-title animate-typewriter">Welcome...</h1> */}
//           <h1
//   className={`hero-title ${animate ? "animate-typewriter" : ""}`}
// >
//   Welcome...
// </h1>

//             <p className="hero-subtitle animate-reveal" style={{ animationDelay: '1.5s' }}>
//               Unlock Your Potential with our Innovative Platform
//             </p>
//             <p className="hero-description animate-reveal" style={{ animationDelay: '2s' }}>
//               Streamline Your Processes and Enhance Your team's Productivity.
//             </p>
//           </div>

//           {/* CTA Section */}
//           <div className="cta-section animate-fade-in-up" >
//             <div className="cta-text">
//               <p className="log-text">Ready to get started?</p>
    
//             </div>
//             <button className="cta-button">Login </button>
//           </div>
// {/* 
//    <Button className="cta-button">
//        Login to Continue
//        </Button> */}
//    {/* Feature Cards */}
//           <div className="feature-cards">
//             <div className="feature-card">
//               <div className="feature-icon">⚡</div>
//               <h3>Fast & Efficient</h3>
//               <p>Streamline your HR processes with our intuitive platform</p>
//             </div>

//             <div className="feature-card">
//               <div className="feature-icon">🔒</div>
//               <h3>Secure & Reliable</h3>
//               <p>Your data is protected with enterprise-grade security</p>
//             </div>

//             <div className="feature-card">
//               <div className="feature-icon">📊</div>
//               <h3>Insightful Analytics</h3>
//               <p>Make data-driven decisions with comprehensive reports</p>
//             </div>
//           </div>
//         </div>
//       </main>
//     </div>
//   );
// };


// import { useState, useEffect } from "react";
// import "./style/HeroSection.css";

// export const HeroSection = () => {
//   const [animate, setAnimate] = useState(true);
//   const [showLogin, setShowLogin] = useState(false);

//   useEffect(() => {
//     const interval = setInterval(() => {
//       setAnimate(false);
//       setTimeout(() => setAnimate(true), 50);
//     }, 3000);
//     return () => clearInterval(interval);
//   }, []);

//   return (
//     <div className="index-container">
//       <div className="background-elements">
//         <div className="bg-circle-1" />
//         <div className="bg-circle-2" />
//       </div>

//       <main className="main-content">
//         <div className={`hero-container ${showLogin ? "shift-left" : ""}`}>
          
//           {/* LEFT TEXT BLOCK */}
//           <div className="hero-text-block">
//             <h1 className={`hero-title ${animate ? "animate-typewriter" : ""}`}>
//               Welcome...
//             </h1>

//             <p className="hero-subtitle animate-reveal" style={{ animationDelay: '1.5s' }}>
//               Unlock Your Potential with our Innovative Platform
//             </p>

//             <p className="hero-description animate-reveal" style={{ animationDelay: '2s' }}>
//               Streamline Your Processes and Enhance Your team's Productivity.
//             </p>

//             <div className="cta-section animate-fade-in-up">
//               <p className="log-text">Ready to get started?</p>

//               <button
//                 className="cta-button"
//                 onClick={() => setShowLogin(true)}
//               >
//                 Explore 
//               </button>
//             </div>
//           </div>

//           {/* RIGHT-SIDE LOGIN CARD */}
//           <div className={`login-card ${showLogin ? "slide-in" : ""}`}>
//             <h2 className="login-text">Login</h2>

//             <input type="email" placeholder="Email" />
//             <input type="password" placeholder="Password" />

//             <p className="forgot">Forgot Password?</p>

//             <button className="login-submit">Submit</button>
//           </div>
//         </div>

//         {/* Feature cards stay same */}
//         <div className="feature-cards">
//           <div className="feature-card">
//             <div className="feature-icon">⚡</div>
//             <h3>Fast & Efficient</h3>
//             <p>Streamline your HR processes with our intuitive platform</p>
//           </div>

//           <div className="feature-card">
//             <div className="feature-icon">🔒</div>
//             <h3>Secure & Reliable</h3>
//             <p>Your data is protected with enterprise-grade security</p>
//           </div>

//           <div className="feature-card">
//             <div className="feature-icon">📊</div>
//             <h3>Insightful Analytics</h3>
//             <p>Make data-driven decisions with comprehensive reports</p>
//           </div>
//         </div>
//       </main>
//     </div>
//   );
// };
// correct one










import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FiEye, FiEyeOff } from "react-icons/fi";

import "./style/HeroSection.css";

export const HeroSection = () => {
   const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [animate, setAnimate] = useState(true);
  const [showLogin, setShowLogin] = useState(false);

// const ClosedEyeIcon = () => (
//   <svg
//     width="30"
//     height="18"
//     viewBox="0 0 30 18"
//     fill="none"
//     stroke="#555"
//     strokeWidth="2"
//     strokeLinecap="round"
//     strokeLinejoin="round"
//   >
//     <path d="M2 9 C26 13, 30 2, 28 7" />
//     <line x1="6" y1="9" x2="4" y2="4" />
//     <line x1="10" y1="7" x2="9" y2="13" />
//     <line x1="15" y1="6" x2="15" y2="12" />
//     <line x1="20" y1="7" x2="21" y2="13" />
//     <line x1="24" y1="9" x2="26" y2="14" />
//   </svg>
// );


// const OpenEyeIcon = () => (
//   <svg
//     width="30"
//     height="18"
//     viewBox="0 0 30 18"
//     fill="none"
//     stroke="#555"
//     strokeWidth="2"
//     strokeLinecap="round"
//     strokeLinejoin="round"
//   >
//     <path d="M2 9 C8 2, 22 2, 28 9 C22 16, 8 16, 2 9" />
//     <circle cx="15" cy="9" r="3" />
//   </svg>
// );


  useEffect(() => {
    const interval = setInterval(() => {
      setAnimate(false);
      setTimeout(() => setAnimate(true), 50);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

 const handleSubmit = async () => {
    
   fetch("http://localhost:5000/api/auth/validate-user", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    identifier: email,
    password: password,
  }),
})
.then((res) => res.json())
.then((data) => {
  console.log(data);
  if (data.success) {
    localStorage.setItem("token", data.token);
    navigate("/dashboard"); // redirect after login
  } else {
    alert(data.message);
  }
})
.catch((err) => console.error(err));

  };


  return (
    <div className="index-container">
      <div className="background-elements">
        <div className="bg-circle-1" />
        <div className="bg-circle-2" />
      </div>

      <main className="main-content">
        <div className={`hero-container ${showLogin ? "shift-left" : ""}`}>
          
          {/* LEFT TEXT BLOCK */}
          <div className="hero-text-block">
            <h1 className={`hero-title ${animate ? "animate-typewriter" : ""}`}>
              Welcome...
            </h1>

            <p className="hero-subtitle animate-reveal" style={{ animationDelay: '1.5s' }}>
              Unlock Your Potential with our Innovative Platform
            </p>

            <p className="hero-description animate-reveal" style={{ animationDelay: '2s' }}>
              Streamline Your Processes and Enhance Your team's Productivity.
            </p>

            <div className="cta-section animate-fade-in-up">
              <p className="log-text">Ready to get started?</p>

              <button
                className="cta-button"
                onClick={() => setShowLogin(true)}
              >
                Explore 
              </button>
            </div>
          </div>

          {/* RIGHT-SIDE LOGIN CARD */}
          <div className={`login-card ${showLogin ? "slide-in" : ""}`}>
            <h2 className="login-text">Login</h2>

            <input type="email" placeholder="Email"  value={email}
        onChange={(e) => setEmail(e.target.value)} />
            {/* <input type="password" placeholder="Password"   value={password}
        onChange={(e) => setPassword(e.target.value)}/> */}
         <div className="password-wrapper">
  <input
    type={showPassword ? "text" : "password"}
    placeholder="Password"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
  />

  {/* 👁 Eye Button */}
    <span className="toggle-eye" onClick={() => setShowPassword(!showPassword)}>
    {showPassword ? <FiEye size={22} /> : <FiEyeOff size={22} />}
  </span>
  {/* <span className="toggle-eye" onClick={() => setShowPassword(!showPassword)}>
  {showPassword ? <OpenEyeIcon /> : <ClosedEyeIcon />}
</span> */}
</div> 

  {error && <p style={{ color: "red" }}>{error}</p>}
            <p className="forgot">Forgot Password?</p>

            <button className="login-submit"  onClick={handleSubmit}>Submit</button>
          </div>
        </div>

        {/* Feature cards stay same */}
        <div className="feature-cards">
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h3>Fast & Efficient</h3>
            <p>Streamline your HR processes with our intuitive platform</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">🔒</div>
            <h3>Secure & Reliable</h3>
            <p>Your data is protected with enterprise-grade security</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Insightful Analytics</h3>
            <p>Make data-driven decisions with comprehensive reports</p>
          </div>
        </div>
      </main>
    </div>
  );
};
