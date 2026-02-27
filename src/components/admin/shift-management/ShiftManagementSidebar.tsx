"use client";

interface ShiftManagementSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const menuItems = [
  { id: 'shifts', label: 'Shifts' },
  { id: 'active-users', label: 'Active Users' },
  { id: 'timesheets', label: 'Timesheets' },
  { id: 'screenshots', label: 'Screenshots' },
];

export default function ShiftManagementSidebar({ activeSection, onSectionChange }: ShiftManagementSidebarProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '2px',
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: '0',
      }}
    >
      {menuItems.map((item) => {
        const isActive = activeSection === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--foreground)' : '2px solid transparent',
              color: isActive ? 'var(--foreground)' : 'var(--foreground-secondary)',
              fontSize: '13px',
              fontWeight: isActive ? 600 : 400,
              cursor: 'pointer',
              marginBottom: '-1px',
              transition: 'color 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.color = 'var(--foreground)';
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.color = 'var(--foreground-secondary)';
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
