"use client";

import { Input } from "@repo/ui/components/input";
import { Button } from "@repo/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { GlobeIcon, InfoIcon, ArrowUpRightIcon } from "lucide-react";

/**
 * Placeholder for URL ingestion.
 *
 * @remarks
 * The backend has no import endpoint yet (planned in ADR-006: S3, pre-signed and public URLs with
 * SSRF protection), so the form is shown disabled instead of failing on submit. Wire it to the API
 * once `POST /imports` exists.
 */
export function UrlImportForm() {
  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-5"
      noValidate
      aria-describedby="url-import-unavailable"
    >
      <Alert variant="warning" id="url-import-unavailable">
        <InfoIcon />
        <AlertTitle>URL import is coming soon</AlertTitle>
        <AlertDescription>
          Importing from a URL or S3 link is not available yet. Upload the PDF from the PDF File
          Upload page instead.
        </AlertDescription>
      </Alert>

      <fieldset disabled className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="url-input" className="text-sm font-medium text-foreground">
            Resource URL
          </label>
          <div className="relative flex items-center">
            <GlobeIcon
              className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="url-input"
              type="url"
              placeholder="https://example.com/research-paper.pdf"
              className="h-11 pl-9 md:text-base"
              data-testid="url-import-input"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="title-input" className="text-sm font-medium text-foreground">
            Title <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="title-input"
            type="text"
            placeholder="Q3 Financial Architecture Report"
            className="h-11 md:text-base"
            data-testid="url-title-input"
          />
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            size="lg"
            className="w-full px-4 sm:w-auto"
            data-testid="submit-url-button"
          >
            <ArrowUpRightIcon data-icon="inline-start" />
            Import URL
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
