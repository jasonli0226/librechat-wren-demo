#!/bin/bash
# Generate bulk retail data into the running retail-postgres container.
#
#   ./scripts/generate-data.sh                      # +500k orders, +20k customers
#   ./scripts/generate-data.sh --orders 2000000     # bigger
#   ./scripts/generate-data.sh --reset --yes        # replace existing orders instead of appending
#
# No restart needed afterwards: the schema is unchanged, so Wren's MDL stays valid.
# Targets the retail-postgres container; set PG_CONTAINER to use another one.
set -euo pipefail
cd "$(dirname "$0")/.."

orders=500000
customers=20000
start_date=2024-01-01
end_date=2025-12-31
growth=0.25
seed=42
reset=false
assume_yes=false

usage() {
  cat <<'EOF'
Usage: scripts/generate-data.sh [options]

  --orders N        orders to add                     (default 500000)
  --customers N     customers to add                  (default 20000)
  --start DATE      first order date, YYYY-MM-DD      (default 2024-01-01)
  --end DATE        last order date, YYYY-MM-DD       (default 2025-12-31)
  --growth X        volume growth across the range    (default 0.25 = +25%)
  --seed N          random seed, 0-1000000            (default 42)
  --reset           delete existing orders, items, payments, shipments and
                    returns first (customers and catalog are kept)
  --yes             skip the --reset confirmation
  -h, --help        show this help
EOF
}

die() { echo "error: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --orders)    orders=${2:-};     shift 2 ;;
    --customers) customers=${2:-};  shift 2 ;;
    --start)     start_date=${2:-}; shift 2 ;;
    --end)       end_date=${2:-};   shift 2 ;;
    --growth)    growth=${2:-};     shift 2 ;;
    --seed)      seed=${2:-};       shift 2 ;;
    --reset)     reset=true;        shift ;;
    --yes)       assume_yes=true;   shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           usage >&2; die "unknown option: $1" ;;
  esac
done

[[ $orders =~ ^[0-9]+$ ]]      || die "--orders must be a non-negative integer"
[[ $customers =~ ^[0-9]+$ ]]   || die "--customers must be a non-negative integer"
[[ $seed =~ ^[0-9]+$ ]] && [ "$seed" -le 1000000 ] || die "--seed must be an integer 0-1000000"
[[ $growth =~ ^-?[0-9]+(\.[0-9]+)?$ ]] || die "--growth must be a number"
date_re='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
[[ $start_date =~ $date_re ]] || die "--start must be YYYY-MM-DD"
[[ $end_date =~ $date_re ]]   || die "--end must be YYYY-MM-DD"
[[ ! $start_date > $end_date ]] || die "--start must not be after --end"

if [ "$reset" = true ] && [ "$assume_yes" != true ]; then
  read -r -p "This deletes all existing orders, items, payments, shipments and returns. Continue? [y/N] " answer
  [[ $answer =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }
fi

seed_frac=$(awk -v s="$seed" 'BEGIN { printf "%.6f", s / 1000000 }')

echo "Generating ${orders} orders and ${customers} customers (${start_date} .. ${end_date})..."
start=$(date +%s)
docker exec -i "${PG_CONTAINER:-retail-postgres}" psql -U postgres -d retail -v ON_ERROR_STOP=1 \
  -v orders="$orders" -v customers="$customers" \
  -v start_date="$start_date" -v end_date="$end_date" \
  -v growth="$growth" -v seed_frac="$seed_frac" -v reset="$reset" \
  < scripts/generate-data.sql
echo "Done in $(( $(date +%s) - start ))s."
