terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
  }
}

provider "cloudflare" {
  # read token from $CLOUDFLARE_API_TOKEN
}

variable "CLOUDFLARE_ACCOUNT_ID" {
  # read account id from $TF_VAR_CLOUDFLARE_ACCOUNT_ID
  type = string
}

variable "project_name" {
  # Base name for all resources (D1: {project_name}_d1, Worker: {project_name}_worker, Pages: {project_name})
  # read from $TF_VAR_project_name
  type    = string
  default = "uptimeflare"
}

variable "custom_domain" {
  # Optional custom domain for the Pages project (e.g., "status.example.com")
  # read from $TF_VAR_custom_domain
  type    = string
  default = ""
}

variable "enable_do_migration" {
  type    = bool
  default = false
}

resource "cloudflare_d1_database" "uptimeflare_d1" {
  account_id = var.CLOUDFLARE_ACCOUNT_ID
  name       = "${var.project_name}_d1"
  read_replication = {
    mode = "auto"
  }
}

resource "cloudflare_workers_script" "uptimeflare_worker" {
  account_id          = var.CLOUDFLARE_ACCOUNT_ID
  script_name         = "${var.project_name}_worker"
  main_module         = "worker/dist/index.js"
  content_file        = "worker/dist/index.js"
  content_sha256      = filesha256("worker/dist/index.js")
  compatibility_date  = "2025-04-02"
  compatibility_flags = ["nodejs_compat"]

  observability = {
    enabled = true
    logs = {
      enabled         = true
      invocation_logs = true
    }
  }

  migrations = var.enable_do_migration ? {
    new_tag            = "v1"
    new_sqlite_classes = ["RemoteChecker"]
  } : null

  bindings = [{
    name       = "REMOTE_CHECKER_DO"
    class_name = "RemoteChecker"
    type       = "durable_object_namespace"
    }, {
    name = "UPTIMEFLARE_D1"
    type = "d1"
    id   = cloudflare_d1_database.uptimeflare_d1.id
  }]
}

resource "cloudflare_workers_cron_trigger" "uptimeflare_worker_cron" {
  account_id  = var.CLOUDFLARE_ACCOUNT_ID
  script_name = cloudflare_workers_script.uptimeflare_worker.script_name
  schedules = [{
    cron = "* * * * *" # every 1 minute, you can reduce the write counts by increase the worker settings of `kvWriteCooldownMinutes`
  }]
}

resource "cloudflare_pages_project" "uptimeflare" {
  account_id        = var.CLOUDFLARE_ACCOUNT_ID
  name              = var.project_name
  production_branch = "main"

  deployment_configs = {
    # SMH Cloudflare provider will throw an error without preview config
    preview = {
      fail_open = false
    }
    production = {
      d1_databases = {
        UPTIMEFLARE_D1 = {
          id = cloudflare_d1_database.uptimeflare_d1.id
        }
      }
      compatibility_date  = "2025-04-02"
      compatibility_flags = ["nodejs_compat"]
      fail_open           = false
    }
  }

  # SMH it will error without this build_config
  build_config = {
    root_dir = "/"
  }
}

# Custom domain for Pages project (only created if custom_domain is set)
resource "cloudflare_pages_domain" "custom_domain" {
  count        = var.custom_domain != "" ? 1 : 0
  account_id   = var.CLOUDFLARE_ACCOUNT_ID
  project_name = cloudflare_pages_project.uptimeflare.name
  domain       = var.custom_domain
}
