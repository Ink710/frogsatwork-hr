// Shared presentational components — server components by default, but hook-free, so they are safe
// to render from either environment.
//
// Deliberately does NOT re-export `makeI18nServer`: that module imports `server-only`, which poisons
// any client bundle it reaches. Keeping it on its own "@hris/ui/i18n-server" subpath means a future
// Client Component can import <Card> from here without hitting a confusing build error.
export { AppShellHeader } from "./AppShellHeader";
export { NotFoundBox } from "./NotFoundBox";
export { LoadingPage } from "./Skeletons";
export { StatusBadge, Avatar, Card, Field, FieldGrid, CardSkeleton, Pill } from "./profile-ui";
export { StatCard, Section } from "./dashboard-ui";
