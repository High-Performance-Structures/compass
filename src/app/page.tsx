import Link from "next/link";
import {
	IconArrowRight,
	IconBrandGithub,
	IconBrandDocker,
	IconBrandApple,
	IconBrandWindows,
	IconBrandAndroid,
	IconDeviceDesktop,
	IconCloud,
	IconSparkles,
	IconPuzzle,
	IconRocket,
	IconShieldLock,
} from "@tabler/icons-react";

const features = [
	{
		num: "01",
		title: "AI Agent Built In",
		description:
			"Every workspace ships with an intelligent assistant " +
			"that understands your domain and takes action " +
			"through tools you define.",
		icon: IconSparkles,
	},
	{
		num: "02",
		title: "Modular by Design",
		description:
			"Scheduling, financials, file management, " +
			"messaging \u2014 drop in what you need, leave " +
			"out what you don\u2019t.",
		icon: IconPuzzle,
	},
	{
		num: "03",
		title: "Deploy Anywhere",
		description:
			"Self-host with Docker, ship to desktop and " +
			"mobile, or deploy to the edge with Cloudflare. " +
			"Your infrastructure, your call.",
		icon: IconRocket,
	},
	{
		num: "04",
		title: "Enterprise Auth",
		description:
			"SSO, directory sync, and role-based access " +
			"control out of the box via WorkOS.",
		icon: IconShieldLock,
	},
] as const;

const platforms = [
	{ icon: IconBrandDocker, label: "Docker" },
	{ icon: IconBrandApple, label: "macOS" },
	{ icon: IconBrandWindows, label: "Windows" },
	{ icon: IconDeviceDesktop, label: "Linux" },
	{ icon: IconBrandApple, label: "iOS" },
	{ icon: IconBrandAndroid, label: "Android" },
	{ icon: IconCloud, label: "Edge" },
] as const;

const modules = [
	"Scheduling",
	"Financials",
	"File Management",
	"Messaging",
	"NetSuite Sync",
	"Google Drive",
	"Themes",
	"Plugins",
] as const;

export default function Home(): React.JSX.Element {
	return (
		<div className="relative min-h-screen bg-[#080808] text-[#E8E4DC]">
			<style>{`
				@keyframes fadeUp {
					from { opacity: 0; transform: translateY(24px); }
					to { opacity: 1; transform: translateY(0); }
				}
				@keyframes fadeIn {
					from { opacity: 0; }
					to { opacity: 1; }
				}
				@keyframes compassSpin {
					from { transform: rotate(0deg); }
					to { transform: rotate(360deg); }
				}
				@keyframes compassNeedle {
					0%, 100% { transform: rotate(-15deg); }
					50% { transform: rotate(15deg); }
				}
				@keyframes pulseGlow {
					0%, 100% { opacity: 0.15; }
					50% { opacity: 0.35; }
				}
				@keyframes gridFade {
					from { opacity: 0; }
					to { opacity: 0.04; }
				}
				.anim-up {
					opacity: 0;
					animation: fadeUp 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards;
				}
				.anim-in {
					opacity: 0;
					animation: fadeIn 1s ease-out forwards;
				}
			`}</style>

			{/* background grid */}
			<div
				className="pointer-events-none fixed inset-0"
				style={{
					opacity: 0,
					animation: "gridFade 2s ease-out 0.5s forwards",
					backgroundImage:
						"linear-gradient(rgba(232,228,220,0.04) 1px, transparent 1px)," +
						"linear-gradient(90deg, rgba(232,228,220,0.04) 1px, transparent 1px)",
					backgroundSize: "80px 80px",
				}}
			/>

			{/* subtle noise texture */}
			<div
				className="pointer-events-none fixed inset-0 opacity-[0.025]"
				style={{
					backgroundImage:
						"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256'" +
						" xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter" +
						" id='n'%3E%3CfeTurbulence type='fractalNoise'" +
						" baseFrequency='0.9' numOctaves='4'" +
						" stitchTiles='stitch'/%3E%3C/filter%3E%3Crect" +
						" width='100%25' height='100%25'" +
						" filter='url(%23n)'/%3E%3C/svg%3E\")",
				}}
			/>

			{/* nav */}
			<nav
				className={
					"anim-in relative z-10 flex items-center " +
					"justify-between px-8 py-7 md:px-16 lg:px-24"
				}
				style={{ animationDelay: "0.1s" }}
			>
				<div className="flex items-center gap-3">
					<span
						className="size-5 shrink-0 bg-[#E8E4DC]"
						style={{
							maskImage: "url(/logo-black.png)",
							maskSize: "contain",
							maskRepeat: "no-repeat",
							WebkitMaskImage: "url(/logo-black.png)",
							WebkitMaskSize: "contain",
							WebkitMaskRepeat: "no-repeat",
						}}
					/>
					<span
						className={
							"text-[11px] font-medium uppercase " +
							"tracking-[0.3em] text-[#E8E4DC]"
						}
					>
						Compass
					</span>
				</div>
				<div className="flex items-center gap-8">
					<a
						href="https://github.com/High-Performance-Structures/compass"
						target="_blank"
						rel="noopener noreferrer"
						className={
							"hidden items-center gap-2 text-[11px] " +
							"uppercase tracking-[0.15em] " +
							"text-[#E8E4DC]/35 transition-colors " +
							"duration-300 hover:text-[#E8E4DC]/70 " +
							"sm:inline-flex"
						}
					>
						<IconBrandGithub
							className="size-3.5"
							stroke={1.5}
						/>
						GitHub
					</a>
					<Link
						href="/dashboard"
						className={
							"text-[11px] uppercase " +
							"tracking-[0.2em] " +
							"text-[#E8E4DC]/50 " +
							"transition-colors duration-300 " +
							"hover:text-[#E8E4DC]"
						}
					>
						Sign In
					</Link>
				</div>
			</nav>

			{/* hero */}
			<section
				className={
					"relative px-8 pt-16 pb-28 " +
					"md:px-16 md:pt-28 md:pb-36 " +
					"lg:px-24 lg:pt-36 lg:pb-44"
				}
			>
				{/* compass rose */}
				<div
					className={
						"pointer-events-none absolute " +
						"right-[-10%] top-[5%] hidden " +
						"size-[520px] lg:block " +
						"xl:size-[620px]"
					}
				>
					<div
						className="absolute inset-0 rounded-full"
						style={{
							border:
								"1px solid rgba(232,228,220,0.12)",
							animation:
								"compassSpin 120s linear infinite",
						}}
					>
						{Array.from({ length: 72 }).map((_, i) => (
							<div
								key={i}
								className="absolute left-1/2 top-0"
								style={{
									height: "100%",
									width: "1px",
									transform:
										`rotate(${i * 5}deg)`,
									transformOrigin: "center",
								}}
							>
								<div
									className="mx-auto"
									style={{
										width: "1px",
										height:
											i % 9 === 0
												? "14px"
												: "6px",
										background:
											i % 9 === 0
												? "rgba(232,228,220,0.22)"
												: "rgba(232,228,220,0.07)",
									}}
								/>
							</div>
						))}
					</div>
					<div
						className="absolute inset-[15%] rounded-full"
						style={{
							border:
								"1px solid rgba(232,228,220,0.08)",
						}}
					/>
					<div
						className="absolute inset-[20%]"
						style={{
							animation:
								"compassNeedle 8s " +
								"ease-in-out infinite",
						}}
					>
						<div
							className={
								"absolute left-1/2 top-[10%] " +
								"h-[40%] w-[2px] " +
								"-translate-x-1/2"
							}
							style={{
								background:
									"linear-gradient(to bottom," +
									" #00C896, transparent)",
								opacity: 0.85,
							}}
						/>
						<div
							className={
								"absolute bottom-[10%] " +
								"left-1/2 h-[40%] w-[1px] " +
								"-translate-x-1/2"
							}
							style={{
								background:
									"linear-gradient(to top," +
									" rgba(232,228,220,0.25)," +
									" transparent)",
							}}
						/>
					</div>
					<div
						className={
							"absolute left-1/2 top-1/2 size-2 " +
							"-translate-x-1/2 -translate-y-1/2 " +
							"rounded-full bg-[#00C896]"
						}
						style={{
							boxShadow:
								"0 0 24px rgba(0,200,150,0.6)",
							animation:
								"pulseGlow 3s ease-in-out infinite",
						}}
					/>
					{(["N", "E", "S", "W"] as const).map(
						(d, i) => {
							const positions = [
								{
									top: "4%",
									left: "50%",
									tx: "-50%",
								},
								{
									top: "50%",
									right: "4%",
									ty: "-50%",
								},
								{
									bottom: "4%",
									left: "50%",
									tx: "-50%",
								},
								{
									top: "50%",
									left: "4%",
									ty: "-50%",
								},
							];
							const pos = positions[i];
							return (
								<span
									key={d}
									className={
										"absolute font-mono " +
										"text-[10px] " +
										"tracking-[0.2em] " +
										"text-[#E8E4DC]/20"
									}
									style={{
										top: pos.top,
										bottom: pos.bottom,
										left: pos.left,
										right: pos.right,
										transform:
											`translate(` +
											`${pos.tx ?? "0"},` +
											`${pos.ty ?? "0"})`,
									}}
								>
									{d}
								</span>
							);
						},
					)}
				</div>

				<div className="relative z-10 max-w-4xl">
					<p
						className={
							"anim-up mb-6 inline-flex " +
							"items-center gap-2 font-mono " +
							"text-[11px] uppercase " +
							"tracking-[0.3em] text-[#00C896] " +
							"md:mb-8"
						}
						style={{ animationDelay: "0.2s" }}
					>
						<span
							className={
								"inline-block size-1.5 " +
								"rounded-full bg-[#00C896]"
							}
							style={{
								boxShadow:
									"0 0 8px rgba(0,200,150,0.5)",
							}}
						/>
						Open Source Platform
					</p>
					<h1
						className={
							"anim-up " +
							"text-[clamp(2.8rem,7.5vw,7rem)] " +
							"font-bold leading-[0.92] " +
							"tracking-[-0.04em]"
						}
						style={{ animationDelay: "0.35s" }}
					>
						Build With
						<br />
						<span className="font-serif italic text-[#00C896]">
							Direction
						</span>
					</h1>
					<p
						className={
							"anim-up mt-8 max-w-md " +
							"text-[15px] leading-[1.8] " +
							"text-[#E8E4DC]/55 md:mt-10 " +
							"md:max-w-lg md:text-[17px]"
						}
						style={{ animationDelay: "0.5s" }}
					>
						An AI-native workspace platform that
						handles auth, deployment, and real-time
						collaboration &mdash; so you can focus on
						building what actually matters.
					</p>

					{/* ctas */}
					<div
						className={
							"anim-up mt-10 flex flex-wrap " +
							"items-center gap-5 md:mt-12"
						}
						style={{ animationDelay: "0.65s" }}
					>
						<Link
							href="/dashboard"
							className={
								"group inline-flex " +
								"items-center gap-3 " +
								"bg-[#00C896] px-8 py-3.5 " +
								"text-[12px] font-semibold " +
								"uppercase tracking-[0.12em] " +
								"text-[#080808] " +
								"transition-all duration-300 " +
								"hover:bg-[#00E0A8] " +
								"hover:shadow-[0_0_30px_" +
								"rgba(0,200,150,0.25)]"
							}
						>
							Get Started
							<IconArrowRight
								className={
									"size-3.5 " +
									"transition-transform " +
									"duration-300 " +
									"group-hover:translate-x-0.5"
								}
								stroke={2.5}
							/>
						</Link>
						<a
							href="https://github.com/High-Performance-Structures/compass"
							target="_blank"
							rel="noopener noreferrer"
							className={
								"group inline-flex " +
								"items-center gap-2.5 border " +
								"border-[#E8E4DC]/15 px-6 " +
								"py-3.5 text-[12px] uppercase " +
								"tracking-[0.1em] " +
								"text-[#E8E4DC]/55 " +
								"transition-all duration-300 " +
								"hover:border-[#E8E4DC]/30 " +
								"hover:text-[#E8E4DC]/80"
							}
						>
							<IconBrandGithub
								className="size-4"
								stroke={1.5}
							/>
							View Source
						</a>
					</div>

					{/* platforms inline */}
					<div
						className={
							"anim-up mt-14 flex flex-wrap " +
							"items-center gap-6 md:mt-16"
						}
						style={{ animationDelay: "0.85s" }}
					>
						<span
							className={
								"text-[10px] uppercase " +
								"tracking-[0.2em] " +
								"text-[#E8E4DC]/25"
							}
						>
							Runs on
						</span>
						{platforms.map((p) => (
							<span
								key={p.label}
								className={
									"flex items-center " +
									"gap-1.5 " +
									"text-[#E8E4DC]/30 " +
									"transition-colors " +
									"duration-300 " +
									"hover:text-[#E8E4DC]/55"
								}
							>
								<p.icon
									className="size-[15px]"
									stroke={1.25}
								/>
								<span
									className={
										"text-[10px] " +
										"uppercase " +
										"tracking-[0.1em]"
									}
								>
									{p.label}
								</span>
							</span>
						))}
					</div>
				</div>
			</section>

			{/* features */}
			<section
				className={
					"relative border-t " +
					"border-[#E8E4DC]/[0.06] px-8 py-20 " +
					"md:px-16 md:py-28 lg:px-24"
				}
			>
				<div
					className="anim-up mb-16 max-w-2xl md:mb-20"
					style={{ animationDelay: "1s" }}
				>
					<p
						className={
							"mb-4 font-mono text-[11px] " +
							"uppercase tracking-[0.3em] " +
							"text-[#00C896]/70"
						}
					>
						What You Get
					</p>
					<h2
						className={
							"text-[clamp(1.8rem,4vw,3rem)] " +
							"font-bold leading-[1.05] " +
							"tracking-[-0.03em]"
						}
					>
						Everything a workspace needs.
						<br />
						<span className="text-[#E8E4DC]/40">
							Nothing it doesn&rsquo;t.
						</span>
					</h2>
				</div>

				<div
					className={
						"grid gap-px md:grid-cols-2 " +
						"lg:grid-cols-4"
					}
				>
					{features.map((f, i) => (
						<div
							key={f.num}
							className={
								"anim-up group relative " +
								"border " +
								"border-[#E8E4DC]/[0.06] " +
								"p-8 transition-all " +
								"duration-500 " +
								"hover:border-[#00C896]/20 " +
								"hover:bg-[#0D0D0D] md:p-10"
							}
							style={{
								animationDelay:
									`${1.1 + i * 0.1}s`,
							}}
						>
							<div
								className={
									"pointer-events-none " +
									"absolute inset-0 " +
									"opacity-0 " +
									"transition-opacity " +
									"duration-500 " +
									"group-hover:opacity-100"
								}
								style={{
									background:
										"radial-gradient(" +
										"ellipse at top left," +
										" rgba(0,200,150,0.04)" +
										", transparent 70%)",
								}}
							/>
							<div className="relative">
								<f.icon
									className={
										"mb-6 size-5 " +
										"text-[#00C896]/50 " +
										"transition-colors " +
										"duration-300 " +
										"group-hover:" +
										"text-[#00C896]"
									}
									stroke={1.5}
								/>
								<span
									className={
										"mb-4 block " +
										"font-mono " +
										"text-[11px] " +
										"text-[#E8E4DC]/15"
									}
								>
									{f.num}
								</span>
								<h3
									className={
										"mb-3 text-[16px] " +
										"font-semibold " +
										"tracking-[-0.01em]"
									}
								>
									{f.title}
								</h3>
								<p
									className={
										"text-[14px] " +
										"leading-[1.7] " +
										"text-[#E8E4DC]/50"
									}
								>
									{f.description}
								</p>
							</div>
						</div>
					))}
				</div>
			</section>

			{/* modules ticker */}
			<section
				className={
					"overflow-hidden border-y " +
					"border-[#E8E4DC]/[0.06] py-6"
				}
			>
				<div
					className="flex items-center gap-8"
				>
					{[...modules, ...modules].map((m, i) => (
						<span
							key={`${m}-${i}`}
							className={
								"flex shrink-0 " +
								"items-center gap-3 " +
								"text-[12px] uppercase " +
								"tracking-[0.15em] " +
								"text-[#E8E4DC]/22"
							}
						>
							<span
								className={
									"size-1 rounded-full " +
									"bg-[#00C896]/40"
								}
							/>
							{m}
						</span>
					))}
				</div>
			</section>

			{/* showcase section */}
			<section
				className={
					"relative px-8 py-24 md:px-16 " +
					"md:py-32 lg:px-24 overflow-hidden"
				}
			>
				<div
					className={
						"grid items-center gap-12 " +
						"md:grid-cols-2 md:gap-16 " +
						"lg:gap-20"
					}
				>
					<div
						className="anim-up"
						style={{ animationDelay: "0.2s" }}
					>
						<p
							className={
								"mb-4 font-mono text-[11px] " +
								"uppercase tracking-[0.3em] " +
								"text-[#00C896]/70"
							}
						>
							Built With Compass
						</p>
						<h2
							className={
								"mb-6 " +
								"text-[clamp(1.6rem," +
								"3.5vw,2.5rem)] " +
								"font-bold leading-[1.1] " +
								"tracking-[-0.02em]"
							}
						>
							HPS Compass
						</h2>
						<p
							className={
								"mb-8 max-w-md text-[15px] " +
								"leading-[1.8] " +
								"text-[#E8E4DC]/50"
							}
						>
							Construction project management
							&mdash; the first product built
							entirely on this platform.
							Scheduling, financials, NetSuite
							integration, and AI-powered
							workflows.
						</p>
						<Link
							href="/dashboard"
							className={
								"group inline-flex " +
								"items-center gap-2 " +
								"text-[12px] " +
								"font-medium uppercase " +
								"tracking-[0.1em] " +
								"text-[#00C896] " +
								"transition-all " +
								"duration-300 " +
								"hover:text-[#00E0A8]"
							}
						>
							Try the Demo
							<IconArrowRight
								className={
									"size-3 " +
									"transition-transform " +
									"duration-300 " +
									"group-hover:" +
									"translate-x-0.5"
								}
								stroke={2.5}
							/>
						</Link>
					</div>

					{/* gantt visualization */}
					<div
						className="anim-up relative"
						style={{ animationDelay: "0.4s" }}
					>
						{/* ambient glow behind */}
						<div
							className={
								"pointer-events-none " +
								"absolute -inset-8"
							}
							style={{
								background:
									"radial-gradient(ellipse " +
									"at center, " +
									"rgba(0,200,150,0.05), " +
									"transparent 70%)",
								filter: "blur(40px)",
							}}
						/>
						<div
							className={
								"relative rounded-md " +
								"border " +
								"border-[#E8E4DC]/[0.08] " +
								"bg-[#0A0A0A] p-5 " +
								"md:p-6"
							}
						>
							{/* gantt header */}
							<div
								className={
									"mb-4 flex " +
									"items-center " +
									"justify-between"
								}
							>
								<div
									className={
										"flex items-center " +
										"gap-3"
									}
								>
									<div className="h-2 w-20 rounded-full bg-[#E8E4DC]/[0.1]" />
									<div className="h-4 w-px bg-[#E8E4DC]/[0.06]" />
									<div className="h-1.5 w-10 rounded-full bg-[#E8E4DC]/[0.05]" />
								</div>
								<div
									className={
										"flex gap-5"
									}
								>
									{["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((m) => (
										<span
											key={m}
											className={
												"font-mono " +
												"text-[9px] " +
												"uppercase " +
												"tracking-wider " +
												"text-[#E8E4DC]/15"
											}
										>
											{m}
										</span>
									))}
								</div>
							</div>
							{/* gantt rows */}
							{[
								{ label: "Foundation", start: 0, width: 22, color: "#00C896", done: true },
								{ label: "Structural", start: 12, width: 30, color: "#00C896", done: true },
								{ label: "Electrical", start: 25, width: 20, color: "#F59E0B", done: false },
								{ label: "Plumbing", start: 28, width: 25, color: "#3B82F6", done: false },
								{ label: "HVAC", start: 38, width: 22, color: "#F59E0B", done: false },
								{ label: "Interior", start: 48, width: 30, color: "#00C896", done: false },
								{ label: "Exterior", start: 42, width: 35, color: "#8B5CF6", done: false },
								{ label: "Landscaping", start: 65, width: 20, color: "#00C896", done: false },
								{ label: "Punch List", start: 78, width: 15, color: "#F59E0B", done: false },
							].map((row, i) => (
								<div
									key={i}
									className={
										"mb-2 flex " +
										"items-center gap-3"
									}
								>
									<span
										className={
											"w-20 shrink-0 " +
											"text-right " +
											"font-mono " +
											"text-[10px] " +
											"text-[#E8E4DC]/25"
										}
									>
										{row.label}
									</span>
									<div
										className={
											"relative h-5 " +
											"flex-1"
										}
									>
										{/* grid lines */}
										<div
											className={
												"absolute " +
												"inset-0 flex"
											}
										>
											{Array.from({ length: 6 }).map((_, j) => (
												<div
													key={j}
													className="h-full flex-1 border-l border-[#E8E4DC]/[0.03]"
												/>
											))}
										</div>
										{/* bar */}
										<div
											className="absolute top-1 h-3 rounded-sm transition-all duration-300"
											style={{
												left: `${row.start}%`,
												width: `${row.width}%`,
												background: `${row.color}${row.done ? "40" : "25"}`,
												borderLeft: `2px solid ${row.color}${row.done ? "80" : "50"}`,
											}}
										>
											{/* progress fill for done items */}
											{row.done && (
												<div
													className="h-full rounded-sm"
													style={{
														width: "100%",
														background: `${row.color}15`,
													}}
												/>
											)}
										</div>
										{/* dependency arrow for some rows */}
										{i === 1 && (
											<div
												className="absolute top-2.5 h-px"
												style={{
													left: `${22}%`,
													width: "3%",
													background: "rgba(232,228,220,0.08)",
												}}
											/>
										)}
									</div>
								</div>
							))}
							{/* today line */}
							<div
								className={
									"pointer-events-none " +
									"absolute top-14 " +
									"bottom-5"
								}
								style={{
									left: "calc(20 * 0.3rem + 80px + 35%)",
									width: "1px",
									background:
										"linear-gradient(" +
										"to bottom, " +
										"rgba(0,200,150,0.4), " +
										"rgba(0,200,150,0.1))",
								}}
							>
								<span
									className={
										"absolute -top-4 " +
										"left-1/2 " +
										"-translate-x-1/2 " +
										"font-mono " +
										"text-[8px] " +
										"uppercase " +
										"text-[#00C896]/50"
									}
								>
									Today
								</span>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* cta closer */}
			<section className="px-8 pb-8 md:px-16 lg:px-24">
				<div
					className={
						"relative overflow-hidden " +
						"bg-[#0D0D0D] px-8 py-20 " +
						"md:px-16 md:py-28 lg:px-24"
					}
					style={{
						border:
							"1px solid rgba(232,228,220,0.05)",
					}}
				>
					<div
						className={
							"pointer-events-none absolute " +
							"right-0 top-0 h-px w-1/3"
						}
						style={{
							background:
								"linear-gradient(to left," +
								" rgba(0,200,150,0.3)," +
								" transparent)",
						}}
					/>
					<div
						className={
							"pointer-events-none absolute " +
							"bottom-0 left-0 h-px w-1/4"
						}
						style={{
							background:
								"linear-gradient(to right," +
								" rgba(0,200,150,0.15)," +
								" transparent)",
						}}
					/>

					<div className="relative max-w-2xl">
						<p
							className={
								"mb-4 font-mono text-[11px] " +
								"uppercase tracking-[0.3em] " +
								"text-[#00C896]/60"
							}
						>
							Get Started
						</p>
						<h2
							className={
								"mb-6 " +
								"text-[clamp(1.8rem," +
								"4vw,3rem)] " +
								"font-bold leading-[1.05] " +
								"tracking-[-0.03em] " +
								"text-[#E8E4DC]"
							}
						>
							Your next product
							<br />
							<span
								className={
									"font-serif italic " +
									"text-[#00C896]"
								}
							>
								starts here.
							</span>
						</h2>
						<p
							className={
								"mb-10 max-w-md text-[15px] " +
								"leading-[1.8] " +
								"text-[#E8E4DC]/50"
							}
						>
							Clone the repo, drop in your
							modules, deploy. Open source and
							free forever.
						</p>

						{/* code snippet */}
						<div
							className={
								"mb-10 inline-flex " +
								"items-center gap-3 border " +
								"border-[#E8E4DC]/[0.08] " +
								"bg-[#080808] px-5 py-3 " +
								"font-mono text-[13px] " +
								"text-[#E8E4DC]/55"
							}
						>
							<span className="text-[#00C896]/60">
								$
							</span>
							git clone compass && bun dev
						</div>

						<div
							className={
								"flex flex-wrap " +
								"items-center gap-5"
							}
						>
							<Link
								href="/dashboard"
								className={
									"group inline-flex " +
									"items-center gap-3 " +
									"bg-[#00C896] px-8 " +
									"py-3.5 text-[12px] " +
									"font-semibold uppercase " +
									"tracking-[0.12em] " +
									"text-[#080808] " +
									"transition-all " +
									"duration-300 " +
									"hover:bg-[#00E0A8] " +
									"hover:shadow-[0_0_30px_" +
									"rgba(0,200,150,0.25)]"
								}
							>
								Launch Dashboard
								<IconArrowRight
									className={
										"size-3.5 " +
										"transition-transform " +
										"duration-300 " +
										"group-hover:" +
										"translate-x-0.5"
									}
									stroke={2.5}
								/>
							</Link>
							<a
								href="https://github.com/High-Performance-Structures/compass"
								target="_blank"
								rel="noopener noreferrer"
								className={
									"inline-flex " +
									"items-center gap-2.5 " +
									"text-[12px] uppercase " +
									"tracking-[0.1em] " +
									"text-[#E8E4DC]/40 " +
									"transition-colors " +
									"duration-300 " +
									"hover:text-[#E8E4DC]/65"
								}
							>
								<IconBrandGithub
									className="size-4"
									stroke={1.5}
								/>
								Star on GitHub
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* footer */}
			<footer
				className={
					"flex items-center justify-between " +
					"px-8 py-8 md:px-16 lg:px-24"
				}
			>
				<span
					className={
						"text-[10px] uppercase " +
						"tracking-[0.15em] " +
						"text-[#E8E4DC]/25"
					}
				>
					&copy; 2026 Compass
				</span>
				<span
					className={
						"text-[10px] uppercase " +
						"tracking-[0.15em] " +
						"text-[#E8E4DC]/25"
					}
				>
					Open Source (MIT)
				</span>
			</footer>
		</div>
	);
}
