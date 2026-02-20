"use client";

interface ShiftManagementSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const menuItems = [
  { id: 'timesheets', label: 'Timesheets' },
  { id: 'screenshots', label: 'Screenshots' },
];

export default function ShiftManagementSidebar({ activeSection, onSectionChange }: ShiftManagementSidebarProps) {
  return (
    <div
      className="w-56 flex-shrink-0 rounded-lg p-2"
      style={{
        background: 'var(--sidebar-background)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <nav className="flex flex-col gap-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              activeSection === item.id ? 'font-medium' : ''
            }`}
            style={{
              background: activeSection === item.id ? 'var(--active-background)' : 'transparent',
              color: activeSection === item.id ? 'var(--foreground)' : 'var(--foreground-secondary)',
            }}
            onMouseEnter={(e) => {
              if (activeSection !== item.id) {
                e.currentTarget.style.background = 'var(--hover-background)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeSection !== item.id) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
