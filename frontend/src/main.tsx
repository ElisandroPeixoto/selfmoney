import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { fetchAuthStatus, type AuthStatus } from "./api/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import "@fontsource-variable/source-serif-4";
import "./styles.css";

// If the API can't be reached, open the app anyway: each page already explains the error.
const OFFLINE: AuthStatus = { auth_required: false, authenticated: true };

fetchAuthStatus()
  .catch(() => OFFLINE)
  .then((authStatus) =>
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <ThemeProvider>
          <BrowserRouter>
            <App authStatus={authStatus} />
          </BrowserRouter>
        </ThemeProvider>
      </StrictMode>,
    ),
  );
