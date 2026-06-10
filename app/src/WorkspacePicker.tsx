// Workspace picker — list existing workspaces, switch, or create a new one.
// Replaces the bare text field; gives the workspace concept real UI.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { spring, TEAL_GRADIENT } from "./theme";

export default function WorkspacePicker({
  value, onChange,
}: { value: string; onChange: (ws: string) => void }) {
  const [list, setList] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const refresh = async () => {
    const r = await window.jcut.listWorkspaces();
    if (r.ok) setList(r.workspaces);
  };
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    // Creating a sequence-less workspace = just selecting it; the first jc command
    // that writes (e.g. sequence-create) will materialize the folders.
    await window.jcut.jc("memory-append",
      ["--workspace", name, "--section", "Workspace", "--note", `Created workspace "${name}".`]);
    setNewName(""); setCreating(false);
    await refresh();
    onChange(name);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {list.map((ws) => (
          <motion.button
            key={ws}
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} transition={spring.bouncy}
            onClick={() => onChange(ws)}
            className="rounded-pill px-3 py-1.5 text-sm ring-1 ring-line"
            style={ws === value ? { background: TEAL_GRADIENT, color: "#fff" } : { background: "var(--surface-2)" }}
          >{ws}</motion.button>
        ))}
        <motion.button
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          onClick={() => setCreating((c) => !c)}
          className="rounded-pill bg-surface2 px-3 py-1.5 text-sm text-dim ring-1 ring-line"
        >+ New</motion.button>
      </div>

      {creating && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}
          className="flex gap-2">
          <input
            autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }}
            placeholder="Project name"
            className="flex-1 rounded-xl bg-surface2 px-3 py-2 text-sm text-ink ring-1 ring-line focus:outline-none"
          />
          <button onClick={create} className="rounded-xl px-4 py-2 text-sm text-white" style={{ background: TEAL_GRADIENT }}>
            Create
          </button>
        </motion.div>
      )}
    </div>
  );
}
