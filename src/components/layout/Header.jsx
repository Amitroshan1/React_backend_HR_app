// import React, { useState } from 'react';
// import '../styles/Header.css'; // Import the CSS file

// export const Header = () => {
//   // State to manage which link is currently hovered over
//   const [hoveredLink, setHoveredLink] = useState(null);

//   const LinkItem = ({ name, href }) => {
//     // Determine if the current link is being hovered
//     const isHovered = hoveredLink === name;

//     return (
//       <a
//         href={href}
//       className="nav-link"// Add hover-active class dynamically
//         onMouseEnter={() => setHoveredLink(name)}
//         onMouseLeave={() => setHoveredLink(null)}
//       >
//         {name}
//         {/* The underline is handled purely by CSS using the ::after pseudo-element */}
//       </a>
//     );
//   };

//   return (
//     <>
//      <header className="header-container">
//       {/* Left Side: Company Logo */}
//       {/* <a href="/" className="logo">
//         CompanyLogo
//       </a> */}

//       {/* Left Side: Company Logo */}
// <a href="/" className="logo">
//   <img 
//     src="/images/saffo.jpeg"   // your logo path
//     alt="Company Logo"
//     className="logo-img"
//   />
// </a>


//       {/* Right Side: Navigation Links */}
//       <nav className="nav-menu">
//         <LinkItem name="Home" href="/" />
//         <LinkItem name="About Us" href="/about" />
//       </nav>
//     </header>
//     </>
   

//   );
// };




import { useState } from "react";
import "../styles/Header.css";

export const Header = () => {
  const [hoveredLink, setHoveredLink] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const LinkItem = ({ name, href }) => (
    <a
      href={href}
      className="nav-link"
      onMouseEnter={() => setHoveredLink(name)}
      onMouseLeave={() => setHoveredLink(null)}
    >
      {name}
    </a>
  );

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  return (
    <header className="header-container">
      {/* Logo */}
      <a href="/" className="logo">
        <img src="/images/saffo.jpeg" alt="Company Logo" className="logo-img" />
      </a>

      {/* Desktop Menu */}
      <nav className="nav-menu">
        <LinkItem name="Home" href="/" />
        <LinkItem name="About Us" href="/about" />
      </nav>

      {/* Hamburger Icon */}
      <div className="hamburger" onClick={toggleMenu}>
        <div style={{ transform: menuOpen ? "rotate(45deg) translate(5px, 5px)" : "" }}></div>
        <div style={{ opacity: menuOpen ? 0 : 1 }}></div>
        <div style={{ transform: menuOpen ? "rotate(-45deg) translate(5px, -5px)" : "" }}></div>
      </div>

      {/* Mobile Menu */}
      <div className={`mobile-menu ${menuOpen ? "active" : ""}`}>
        <LinkItem name="Home" href="/" />
        <LinkItem name="About Us" href="/about" />
      </div>
    </header>
  );
};
