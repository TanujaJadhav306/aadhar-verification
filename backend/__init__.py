"""
Project backend package marker.

This file ensures `backend.app.main:app` resolves to this repository's code
when running uvicorn, instead of any third-party `backend` package that may
be installed in the environment.
"""



