# Legacy custom dashboard visibility

The legacy agent-generated dashboard interface is temporarily hidden from the
primary navigation. Dashboard records remain in `custom_dashboards`; this
change does not delete or rewrite user data.

The direct `/dashboard/boards/{id}` route and existing server actions remain
available for controlled recovery. Restoring dashboard creation or navigation
should follow a product review of the supported generation, editing, and
permission model. Until then:

- the dashboard page does not offer a customization shortcut;
- generated interfaces do not offer a save-as-dashboard action; and
- saved dashboards are not listed in the sidebar.

If permanent removal is approved later, add an explicit archive field and a
reversible migration before removing records.
