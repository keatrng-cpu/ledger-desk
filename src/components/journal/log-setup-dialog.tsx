              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting
                  ? "Logging…"
                  : mode === "live"
                    ? "Save LIVE trade"
                    : "Save PAPER trade"}
              </Button>
