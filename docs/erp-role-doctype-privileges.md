# Role-specific DocType and accounting privileges

This change creates an additive, default-deny catalogue for nine ERP roles. Each role receives individual READ, CREATE, EDIT_DRAFT, DELETE_DRAFT, SUBMIT, REVIEW, APPROVE, POST and EXPORT capabilities for eligible DocTypes and accounting functions. REVERSE is not granted until a controlled reversal workflow exists.

This catalogue is not connected to live authenticated sessions, existing APIs or posting. Existing User.role enum, authentication, posting, inventory and GST workflows are unchanged.

Next steps: persist company-scoped multi-role assignments, map actual document endpoints, enforce checks server-side, preserve maker-checker separation and perform migration plus UAT before activation.
