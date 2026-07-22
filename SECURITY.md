# Security policy

## Supported version

The latest tagged release receives security fixes. This repository is a
resilience reference implementation, not a hosted incident-management service.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not include credentials, customer data, or production incident details in a
public issue.

## Test-only API route

The API registers `POST /__test/reset` only when `LAB_TEST_RESET_TOKEN` is set.
The browser suite supplies that variable to its isolated test process. Do not
enable this route in a deployed environment.
