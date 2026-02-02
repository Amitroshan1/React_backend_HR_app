// import { useState } from "react";

// export const SelectRole = () => {
//   const [userName, setUserName] = useState("");
//   const [password, setPassword] = useState("");
//   const [errors, setErrors] = useState({});

//   const handleSubmit = async (e) => {
//     e.preventDefault();

//     const res = await fetch("http://localhost:5000/select_role", {
//       method: "POST",
//       credentials: "include",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         user_name: userName,
//         password: password,
//       }),
//     });

//     const data = await res.json();

//     if (data.redirect) {
//       window.location.href = data.redirect;
//     } else {
//       setErrors(data.errors || {});
//     }
//   };

//   return (
//     <div className="login-container">
//       <h2>Login</h2>

//       <form onSubmit={handleSubmit}>
//         <label>Email or Mobile</label>
//         <input
//           type="text"
//           value={userName}
//           onChange={(e) => setUserName(e.target.value)}
//         />
//         {errors.user_name && <p className="error">{errors.user_name}</p>}

//         <label>Password</label>
//         <input
//           type="password"
//           value={password}
//           onChange={(e) => setPassword(e.target.value)}
//         />
//         {errors.password && <p className="error">{errors.password}</p>}

//         <button type="submit">Submit</button>
//       </form>

//       <a href="http://localhost:5000/forgot_password">Forgot Password?</a>
//     </div>
//   );
// }








import { useState } from "react";

export const SelectRole = () => {
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    const res = await fetch("http://localhost:5000/select_role", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_name: userName,
        password: password,
      }),
    });

    const data = await res.json();

    if (data.redirect) {
      window.location.href = data.redirect;
    } else if (data.error) {
      setError(data.error);
    }
  };

  return (
    <div style={{ width: "400px", margin: "100px auto" }}>
      <h2>Employee Login</h2>

      {error && <p style={{ color: "red" }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <label>Email or Mobile</label>
        <input
          type="text"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          style={{ width: "100%", padding: "10px", marginBottom: "15px" }}
        />

        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: "10px", marginBottom: "20px" }}
        />

        <button type="submit" style={{ width: "100%", padding: "12px" }}>
          Submit
        </button>
      </form>
    </div>
  );
}
