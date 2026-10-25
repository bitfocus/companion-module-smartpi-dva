## SmartPi DVA

Queues saved announcements on a SmartPi DVA Node through its Remote API, and reports the Node's status.

### Configuration

| Field                      | Use                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Host                       | Address of the DVA Node                                                                  |
| Protocol                   | HTTP or HTTPS                                                                            |
| Allow Insecure Connections | HTTPS only. Accepts a self-signed or otherwise untrusted certificate                     |
| Use X-API-Key / X-API-Key  | Only needed when the Remote API key is enabled on the Node                               |
| Update Interval (S)        | How often, in seconds, the announcement and group lists and the variables are read again |

New announcements and groups appear in the action's lists after the next update.

### Actions

| Action       | Options                                         |
| ------------ | ----------------------------------------------- |
| Add to Queue | Announcement, and one or more Groups to play on |

### Variables

| Variable                 | Value                                  |
| ------------------------ | -------------------------------------- |
| `$(smartpi-dva:node_id)` | ID of the Node the connection talks to |
| `$(smartpi-dva:status)`  | That Node's status, e.g. `Ok`          |

Each Node in the system also gets its own set, where `<id>` is its Node ID, e.g. `$(smartpi-dva:node_1_cpu_load)`:

| Variable                                  | Value                                        |
| ----------------------------------------- | -------------------------------------------- |
| `$(smartpi-dva:node_<id>_name)`           | Node name                                    |
| `$(smartpi-dva:node_<id>_description)`    | Node description                             |
| `$(smartpi-dva:node_<id>_online_status)`  | e.g. `Online`                                |
| `$(smartpi-dva:node_<id>_logged_on_user)` | User logged on to the Node                   |
| `$(smartpi-dva:node_<id>_last_update)`    | When the Node last reported, in Unix seconds |
| `$(smartpi-dva:node_<id>_cpu_load)`       | CPU load, in percent                         |

If the Node stops answering, the variables keep their last values. The connection's status shows the failure.
