-- The website's own Robinhood sign-in.
--
-- One row per trader. The refresh token stays here, so opening the desk
-- again does not send the trader back through Robinhood. The access token
-- is short-lived and is replaced by the sender. Nothing in this table is
-- written to the browser.

create table if not exists rh_oauth_client (
  redirect_uri text primary key,
  client_id text not null
);

create table if not exists rh_oauth (
  user_id text primary key,
  client_id text not null,
  redirect_uri text not null,
  refresh_token text not null,
  access_token text,
  access_expires_at bigint,
  updated_at bigint not null
);

alter table rh_oauth_client enable row level security;
alter table rh_oauth enable row level security;
