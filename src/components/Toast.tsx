import { AnimatePresence, motion } from "framer-motion";
import { useUIStore } from "../store/useUIStore";

export default function Toast() {
  const msg = useUIStore((s) => s.toastMsg);
  return (
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
  );
}
