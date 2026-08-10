# Dashboard metric semantics

The dashboard is calculated at one server `asOf` instant and every query applies the authenticated organization before grouping, filtering, or limiting.

- Open pipeline includes non-archived open deals. Values remain separated by currency; unlike currencies are never summed.
- Stage distribution uses those same open deals and the organization’s active stage order.
- Won/lost trend includes non-archived deals whose current outcome was updated in the trailing 90 days.
- Recent activity is the ten latest events by occurrence time, with stable ID tie-breaking.
- Overdue tasks are unfinished, non-archived tasks due before `asOf`. Upcoming tasks run from `asOf` through seven days later.
- Closing soon includes open, non-archived deals whose calendar close date is today through 30 days ahead.
- Stale accounts are active customers or prospects with no activity in the trailing 30 days, including accounts with no activity at all.

Metric links encode the source filter in the URL. Empty organizations show zeros and explanatory empty copy rather than fabricated trends.
