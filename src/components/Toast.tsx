import { AnimatePresence, motion } from "framer-motion";
import { useUIStore } from "../store/useUIStore";

export default function Toast() {
  const msg = useUIStore((s) => s.toastMsg);
  return (
    // Centering (left:0;right:0;justify-content:center) lives on this static
    // wrapper, never on the animated element. Framer Motion drives the
    // `.toast` bubble's own `transform` (for its y-slide animation) and
    // overwrites anything set there via CSS — so a `transform: translateX(-50%)`
    // on the animated element itself gets clobbered the instant the animation
    // starts, which is what was pushing the toast off-center to the right.
    <div className="toast-wrap">
      <AnimatePresence>
        {msg && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18 }}
          >
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
