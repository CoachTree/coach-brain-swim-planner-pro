import { Toaster as Sonner, toast } from "sonner";

/**
 * App-level Toaster.
 *
 * Originally imported `useTheme` from `next-themes`, which is a Next.js-
 * specific package whose runtime can resolve to a thenable in some
 * production bundler configurations. Under React 19 strict rendering that
 * surfaces as the cryptic minified error #306 ("Element type is invalid.
 * Received a promise…"). Removing the dependency removes the failure
 * mode — and we don't have theme switching anyway, so a hard-coded
 * `theme="light"` is the right choice for this design.
 */
const Toaster = (props) => (
  <Sonner
    theme="light"
    className="toaster group"
    toastOptions={{
      classNames: {
        toast:
          "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
        description: "group-[.toast]:text-muted-foreground",
        actionButton:
          "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        cancelButton:
          "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
