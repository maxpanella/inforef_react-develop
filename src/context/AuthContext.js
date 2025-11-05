// In src/context/AuthContext.js, sostituisci la funzione login con questa versione più sicura:

import React, { createContext, useContext, useState, useEffect } from "react";
import md5 from "blueimp-md5";
import { env } from "../services/env";

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginError, setLoginError] = useState(null);

  // For development: auto-authenticate and set mock site if using mock
  useEffect(() => {
    if (env.useMock) {
      setIsAuthenticated(true);
      setCurrentUser({ username: env.REACT_APP_ADMIN_USERNAME, role: "admin" });
    }
  }, []);

  const login = (username, password) => {
    setLoginError(null);

    // Per sicurezza, aggiungiamo una verifica sulla lunghezza della password
    if (!password || password.length < 6) {
      setLoginError("Password non valida");
      return false;
    }

    // Calcolo dell'hash MD5 per confronto
    const hash = md5(password);
    console.log("Login attempt:", username);

    // In produzione, si dovrebbe usare un metodo più sicuro (bcrypt, JWT, ecc.)
    if (username === env.adminUser && hash === env.adminHash) {
      setIsAuthenticated(true);
      setCurrentUser({ username, role: "admin" });

      // Salviamo il timestamp del login
      localStorage.setItem("authTimestamp", Date.now().toString());
      return true;
    }

    setLoginError("Credenziali non valide");
    return false;
  };

  const logout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    localStorage.removeItem("authTimestamp");
  };

  // Verifica automatica della sessione ogni minuto
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkSession = () => {
      const authTimestamp = localStorage.getItem("authTimestamp");
      if (!authTimestamp) {
        logout();
        return;
      }

      // Timeout sessione dopo 8 ore (28800000 ms)
      const SESSION_TIMEOUT = 28800000;
      const now = Date.now();
      const timeElapsed = now - parseInt(authTimestamp, 10);

      if (timeElapsed > SESSION_TIMEOUT) {
        console.log("Sessione scaduta");
        logout();
      }
    };

    const interval = setInterval(checkSession, 60000); // Controlla ogni minuto
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        currentUser,
        login,
        logout,
        loginError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
