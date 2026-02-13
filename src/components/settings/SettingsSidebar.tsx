"use client";

interface SettingsSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

interface MenuItem {
  id: string;
  label: string;
  hidden?: boolean;
}

// All menu items - hidden ones are kept for future use but not rendered
const menuItems: MenuItem[] = [
  { id: 'personal-info', label: 'Personal Information' },
  { id: 'section-2', label: 'Section 2', hidden: true },
  { id: 'section-3', label: 'Section 3', hidden: true },
];

// Only show visible items
const visibleMenuItems = menuItems.filter(item => !item.hidden);

export default function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  return (
    <div
      className="w-56 flex-shrink-0 rounded-lg p-2"
      style={{
        background: 'var(--sidebar-background)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <nav className="flex flex-col gap-1">
        {visibleMenuItems.map((item) => (
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
