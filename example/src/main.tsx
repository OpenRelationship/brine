import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Brine } from "../../src/ui/Brine"
import "../../src/ui/brine.css"
import { interview } from "./interview"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Brine interview={interview} brand={{ name: "Bakery" }} />
  </StrictMode>,
)
